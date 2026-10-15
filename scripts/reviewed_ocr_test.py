"""Fail-closed boundaries of the independently reviewed OCR assembler."""
import contextlib
import hashlib
import importlib.util
import io
import json
import pathlib
import tempfile
import unittest
from pypdf import PdfWriter

ROOT = pathlib.Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('reviewed_ocr', ROOT / 'convert-reviewed-ocr.py')
ocr = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ocr)

class ReviewedOcrTests(unittest.TestCase):
    def fixture(self, directory, *, omit_page=False, blocked=False, wrong_review_pdf=False):
        pdf = directory / 'source.pdf'
        writer = PdfWriter()
        writer.add_blank_page(width=300,height=400)
        writer.add_blank_page(width=300,height=400)
        writer.write(pdf)
        digest = lambda file: hashlib.sha256(file.read_bytes()).hexdigest()
        blocks = directory / 'blocks.json'
        content = [{'sourceId':'eq-1','kind':'equation','pdfPages':[1],'html':'<math><mi>x</mi><mo>=</mo><mn>1</mn></math>'}]
        if not omit_page: content.append({'sourceId':'p2','kind':'paragraph','pdfPages':[2],'html':'<p>See <a href="#eq-1">equation 1</a>.</p>'})
        blocks.write_text(json.dumps(content))
        review = directory / 'review.json'
        review.write_text(json.dumps({'sourcePdfSha256': '0'*64 if wrong_review_pdf else digest(pdf),'importAssessment':{'canImport':not blocked,'blocked':blocked}}))
        recipe = directory / 'recipe.json'
        recipe.write_text(json.dumps({'title':'Test paper','expectedPdfSha256':digest(pdf),'sourceBlocksSha256':digest(blocks),'reviewSha256':digest(review),'ocr':{'scope':'full-pages','reviewedPdfPages':[1,2],'humanReviewed':False}}))
        return pdf,blocks,review,recipe,directory/'converted'

    def test_preserves_reference_alias_and_separates_native_coverage_from_reviewed_ocr(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=self.fixture(pathlib.Path(tmp))
            with contextlib.redirect_stdout(io.StringIO()): ocr.convert(*args)
            data=json.loads((args[-1]/'conversion.json').read_text())
            self.assertEqual(data['coverage']['sourceCharacters'],0)
            self.assertEqual(data['ocr']['reviewedPdfPages'],[1,2])
            self.assertIn('raster completeness is established separately',data['coverage']['excludedReason'])
            html=(args[-1]/'en.html').read_text()
            self.assertIn('id="eq-1"',html)
            self.assertIn('href="#eq-1"',html)

    def test_refuses_an_independent_review_for_another_pdf_or_with_blocking_findings(self):
        for option,message in [('wrong_review_pdf','another source PDF'),('blocked','blocking findings')]:
            with self.subTest(option=option), tempfile.TemporaryDirectory() as tmp:
                args=self.fixture(pathlib.Path(tmp),**{option:True})
                with self.assertRaisesRegex(ValueError,message): ocr.convert(*args)

    def test_refuses_page_omission_and_changed_reviewed_blocks(self):
        with tempfile.TemporaryDirectory() as tmp:
            args=self.fixture(pathlib.Path(tmp),omit_page=True)
            with self.assertRaisesRegex(ValueError,'omits a source page'): ocr.convert(*args)
        with tempfile.TemporaryDirectory() as tmp:
            args=self.fixture(pathlib.Path(tmp))
            args[1].write_text(args[1].read_text()+' ')
            with self.assertRaisesRegex(ValueError,'blocks or review receipt changed'): ocr.convert(*args)

if __name__=='__main__': unittest.main()
