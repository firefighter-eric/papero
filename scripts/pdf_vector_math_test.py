"""Regression tests for original-PDF mathematical vector handling."""
import importlib.util
import pathlib
import sys
import unittest
import collections
from types import SimpleNamespace


SCRIPTS = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(SCRIPTS))
import pdf_vector_math as vectors

CONVERTER_SPEC = importlib.util.spec_from_file_location('convert_pdf', SCRIPTS / 'convert-pdf.py')
convert_pdf = importlib.util.module_from_spec(CONVERTER_SPEC)
CONVERTER_SPEC.loader.exec_module(convert_pdf)


class FakePdfMathVectors:
    def __init__(self, bounds):
        self.bounds = bounds
        self.images = []

    def glyph(self, page, char):
        return {'bounds': self.bounds[char['_source'][1]]}

    def image(self, page, chars):
        indices = tuple(char['_source'][1] for char in chars)
        self.images.append(indices)
        return f'<svg data-glyphs="{",".join(map(str, indices))}"></svg>'


def glyph(index, text, x, baseline, font='NimbusRoman-Regular', size=10, height=100):
    width = max(2, len(text) * size * 0.55)
    return {
        '_source': (1, index), 'text': text, 'fontname': font, 'size': size,
        'x0': x, 'x1': x + width, 'top': baseline - size * 0.7,
        'bottom': baseline + size * 0.2,
        'matrix': (1, 0, 0, 1, x, height - baseline),
    }


def converter_for(chars, bounds):
    converter = convert_pdf.Converter.__new__(convert_pdf.Converter)
    converter.pdf = SimpleNamespace(pages=[SimpleNamespace(height=100, annots=[])])
    converter.math_vectors = FakePdfMathVectors(bounds)
    return converter


class GeometryTests(unittest.TestCase):
    def test_cairo_font_family_split_uses_unique_geometric_match_and_rejects_ambiguity(self):
        char = glyph(0, 'b', 10, 40, 'PDF+MinionPro-It', size=9.3)
        helper = vectors.PdfMathVectors.__new__(vectors.PdfMathVectors)
        helper.pdf = SimpleNamespace(pages=[SimpleNamespace(height=100)])
        grid = collections.defaultdict(list)
        actual = {'symbol': 'glyph-15-0', 'x': 9.81, 'y': 39.65}
        grid[(9, 39)].append(actual)
        helper.pages = {1: {'cache': {}, 'families': {'PDF+MinionPro-It': '32'}, 'grid': grid}}
        self.assertIs(helper.glyph(1, char), actual)
        helper.pages[1]['cache'].clear()
        grid[(9, 39)].append({'symbol': 'glyph-16-0', 'x': 10.19, 'y': 39.65})
        with self.assertRaisesRegex(ValueError, 'no unique vector counterpart'):
            helper.glyph(1, char)

    def test_utf16_pdf_destinations_resolve_to_the_same_anchor_as_unicode_names(self):
        char = glyph(0, 'x', 10, 40)
        converter = converter_for([char], {})
        name = 'nature16961.indd:Anchor 10:10'
        converter.pdf.pages[0].annots = [{'x0': 0, 'x1': 50, 'top': 0, 'bottom': 100,
                                         'data': {'A': {'D': b'\xfe\xff' + name.encode('utf-16-be')}}}]
        self.assertEqual(converter.link(1, char), '#' + converter.anchor(name))
        long_name = name + ': ' + 'reference ' * 30
        self.assertLess(len(converter.anchor(long_name)), 160)
        self.assertNotEqual(converter.anchor(long_name), converter.anchor(long_name + '2'))

    def test_path_bounds_handles_lines_cubics_negative_and_fractional_coordinates(self):
        self.assertEqual(vectors.path_bounds('M 2.25,-4 L 8,3 C 12,4 14,6 9,10 Z'),
                         (2.25, -4.0, 14.0, 10.0))
        self.assertEqual(vectors.path_bounds('M -15 2.5 L 4 8'), (-15.0, 2.5, 4.0, 8.0))
        self.assertIsNone(vectors.path_bounds(''))

    def test_path_bounds_rejects_unsupported_or_malformed_cairo_paths(self):
        with self.assertRaisesRegex(ValueError, 'Unsupported'):
            vectors.path_bounds('M 0 0 H 10')
        with self.assertRaisesRegex(ValueError, 'Odd'):
            vectors.path_bounds('M 0 0 L 1')

    def test_transform_composition_and_rotated_bounds_are_conservative(self):
        self.assertEqual(vectors.transform_value(''), (1, 0, 0, 1, 0, 0))
        rotation = vectors.transform_value('matrix(0 1 -1 0 3 4)')
        self.assertEqual(vectors.transformed((1, 2, 5, 6), rotation), (-3.0, 5.0, 1.0, 9.0))
        combined = vectors.multiply((1, 0, 0, 1, 2, 3), (2, 0, 0, 2, 0, 0))
        self.assertEqual(combined, (2, 0, 0, 2, 2, 3))
        self.assertEqual(vectors.transformed((1, 1, 4, 5), combined), (4, 5, 10, 13))
        self.assertEqual(vectors.union([(2, 4, 8, 9), (-1, 3, 5, 12)]), (-1, 3, 8, 12))


class VectorLineTests(unittest.TestCase):
    def test_display_equation_keeps_roman_e_and_equation_number_in_one_svg(self):
        chars = [
            glyph(0, 'E', 10, 40),
            glyph(1, '+', 22, 40, 'ABC+CMMI10'),
            glyph(2, 'x', 30, 40, 'ABC+CMMI10'),
            glyph(3, '=', 39, 40, 'ABC+CMSY10'),
            glyph(4, '1', 48, 40),
            glyph(5, '(', 56, 40),
            glyph(6, '1', 62, 40),
            glyph(7, ')', 68, 40),
        ]
        bounds = {0: (10, 30, 15, 40), 1: (22, 30, 27, 40), 2: (30, 30, 35, 40),
                  3: (39, 30, 44, 40), 4: (48, 30, 53, 40), 5: (56, 30, 60, 40),
                  6: (62, 30, 66, 40), 7: (68, 30, 72, 40)}
        converter = converter_for(chars, bounds)

        lines = converter.vector_lines(1, chars)

        self.assertEqual(len(lines), 1)
        self.assertEqual(len(converter.math_vectors.images), 1)
        self.assertEqual(set(converter.math_vectors.images[0]), set(range(8)))
        self.assertIn('data-glyphs=', lines[0]['html'])
        self.assertEqual(lines[0]['prose_html'], '')
        self.assertEqual(lines[0]['text'], 'E+x=1(1)')

    def test_small_cmr5_limit_and_tall_radical_follow_nearest_math_glyph_not_lower_prose(self):
        chars = [
            glyph(0, '∑', 30, 40, 'ABC+CMMI10'),
            glyph(1, 'i', 31, 52, 'ABC+CMR5', size=5),
            glyph(2, '√', 26, 55, 'ABC+CMEX10', size=12),
            glyph(3, 'a', 43, 54),
            glyph(4, 'n', 49, 54),
            glyph(5, 'd', 55, 54),
        ]
        bounds = {0: (30, 28, 38, 40), 1: (32, 43, 35, 47), 2: (25, 18, 31, 47),
                  3: (43, 45, 48, 54), 4: (49, 45, 54, 54), 5: (55, 45, 60, 54)}
        converter = converter_for(chars, bounds)

        lines = converter.vector_lines(1, chars)

        formula = next(line for line in lines if line['html'].startswith('<svg'))
        prose = next(line for line in lines if line['prose_text'])
        self.assertEqual(set(converter.math_vectors.images[0]), {0, 1, 2})
        self.assertIn('data-glyphs=', formula['html'])
        self.assertEqual(formula['prose_text'], '')
        self.assertEqual(prose['prose_text'], 'and')
        self.assertNotIn('<svg', prose['prose_html'])

    def test_adjacent_display_lines_merge_as_original_geometry_without_absorbing_prose(self):
        chars = [
            glyph(0, 'x', 10, 30, 'ABC+CMMI10'), glyph(1, '=', 20, 30, 'ABC+CMSY10'), glyph(2, '1', 30, 30, 'ABC+CMMI10'),
            glyph(3, 'y', 10, 46, 'ABC+CMMI10'), glyph(4, '=', 20, 46, 'ABC+CMSY10'), glyph(5, '2', 30, 46, 'ABC+CMMI10'),
            glyph(6, 'r', 10, 62), glyph(7, 'e', 16, 62), glyph(8, 's', 22, 62),
            glyph(9, 'u', 28, 62), glyph(10, 'l', 34, 62), glyph(11, 't', 40, 62),
        ]
        bounds = {index: (char['x0'], char['top'], char['x1'], char['bottom']) for index, char in enumerate(chars)}
        converter = converter_for(chars, bounds)

        lines = converter.vector_lines(1, chars)

        self.assertEqual(len(lines), 2)
        self.assertEqual(len(converter.math_vectors.images), 1)
        self.assertEqual(set(converter.math_vectors.images[0]), {0, 1, 2, 3, 4, 5})
        self.assertIn('data-glyphs=', lines[0]['html'])
        self.assertEqual(lines[0]['prose_html'], '')
        self.assertEqual(lines[1]['prose_text'], 'result')
        self.assertNotIn('<svg', lines[1]['html'])
        self.assertNotIn('result', lines[0]['html'])


if __name__ == '__main__':
    unittest.main()
