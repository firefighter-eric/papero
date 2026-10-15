#!/usr/bin/env python3
"""Assemble hash-bound, independently reviewed PDF OCR blocks as semantic HTML.

The native character coverage describes only the PDF text layer. Raster-page
completeness is a separate, explicit review receipt, never inferred from that
character count. Raw model responses and corrected blocks remain working data.
"""
import argparse, hashlib, html, json, pathlib, re, shutil
import pdfplumber
import pypdf
VERSION = '1.0.0'

def digest(data): return hashlib.sha256(data).hexdigest()
def read_json(file): return json.loads(pathlib.Path(file).read_text())
def safe_relative(value):
    p = pathlib.Path(value)
    if p.is_absolute() or '..' in p.parts: raise ValueError('Unsafe OCR asset path')
    return p

def convert(pdf_file, blocks_file, review_file, recipe_file, out):
    recipe_bytes = recipe_file.read_bytes(); recipe = json.loads(recipe_bytes)
    pdf_bytes = pdf_file.read_bytes(); raw_blocks = blocks_file.read_bytes(); review_bytes = review_file.read_bytes()
    if digest(pdf_bytes) != recipe['expectedPdfSha256']: raise ValueError('Source PDF changed')
    if digest(raw_blocks) != recipe['sourceBlocksSha256'] or digest(review_bytes) != recipe['reviewSha256']:
        raise ValueError('Reviewed OCR blocks or review receipt changed')
    review = json.loads(review_bytes)
    reviewed_pdf = review.get('sourcePdfSha256') or review.get('pdfSha256') or review.get('fingerprints',{}).get('sourcePdfSha256')
    if reviewed_pdf != digest(pdf_bytes): raise ValueError('Independent review is for another source PDF')
    assessment = review.get('importAssessment',{})
    if assessment.get('canImport') is False or assessment.get('blocked') is True: raise ValueError('Independent OCR review still reports blocking findings')
    records = json.loads(raw_blocks)
    if isinstance(records, dict): records = records['blocks']
    if not isinstance(records, list) or not records: raise ValueError('Empty reviewed OCR source')
    existing_ids = {value for r in records for value in re.findall(r'\bid=["\']([^"\']+)',r['html'])}
    out.mkdir(parents=True, exist_ok=True); (out/'assets').mkdir(exist_ok=True)
    assets, blocks, images = [], [], {}
    title = recipe['title']; normalized = lambda s: ''.join(c.lower() for c in html.unescape(re.sub('<[^>]+>', '',s)) if c.isalnum())
    with pdfplumber.open(pdf_file) as pdf:
        page_count = len(pdf.pages)
        if recipe['ocr']['reviewedPdfPages'] != list(range(1,page_count+1)): raise ValueError('OCR review omits PDF pages')
        for record in records:
            pages = record.get('pdfPages')
            if not pages or any(not isinstance(p,int) or p<1 or p>page_count for p in pages): raise ValueError('Invalid OCR block page mapping')
            content = record['html']; kind = record['kind']
            if kind == 'title' or (kind == 'heading' and normalized(content) == normalized(title)): continue
            if kind in ['authors','footnote','note','pageHeader','theorem']: kind = 'paragraph'
            if kind == 'references': kind = 'reference'
            if kind not in ['heading','paragraph','reference','table','figure','equation','algorithm']: raise ValueError(f'Unsupported OCR block: {kind}')
            # Every imported image is either an exact local crop with a receipt
            # or an explicit fixed-PDF crop from the public layout recipe.
            for src in re.findall(r'<img\b[^>]*\bsrc=["\']([^"\']+)', content):
                if src in images:
                    content = content.replace(src, 'assets/'+images[src]); continue
                override = recipe.get('assetOverrides',{}).get(src)
                if override:
                    page_no = override['pdfPage']; bounds = override['pdfBounds']; filename = override['filename']; resolution = override.get('resolution',240)
                    pdf.pages[page_no-1].crop(tuple(bounds)).to_image(resolution=resolution).save(out/'assets'/filename)
                    provenance = {'pdfPage':page_no,'pdfBounds':bounds,'resolution':resolution,'method':'reviewed-figure-crop'}
                else:
                    relative = safe_relative(src); source = blocks_file.parent/relative
                    receipts = recipe.get('imageReceipts',{})
                    receipt = receipts.get(src)
                    if not receipt or digest(source.read_bytes()) != receipt['sha256']: raise ValueError(f'OCR crop lacks a matching source receipt: {src}')
                    filename = receipt.get('filename',relative.name)
                    shutil.copyfile(source,out/'assets'/filename)
                    provenance = {'pdfPage':receipt['pdfPage'],'pdfBounds':receipt['pdfBounds'],'resolution':receipt['resolution'],'method':'reviewed-source-formula-crop'}
                if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]*\.png',filename): raise ValueError('Unsafe public OCR crop filename')
                data = (out/'assets'/filename).read_bytes()
                if not data.startswith(b'\x89PNG\r\n\x1a\n'): raise ValueError('OCR crop is not a PNG')
                assets.append({'filename':filename,**provenance,'sha256':digest(data),'bytes':len(data)})
                images[src] = filename; content = content.replace(src,'assets/'+filename)
            # A caption-only source record remains semantic prose rather than an
            # empty figure. It is retained in its original reading order.
            if kind == 'figure' and '<img' not in content and '<table' not in content: kind = 'paragraph'
            source_id = f'ocr-p{pages[0]:02}-block-{len(blocks)+1:03}'
            original_id = record.get('sourceId')
            alias = f'<span id="{html.escape(original_id,quote=True)}"></span>' if original_id and re.fullmatch(r'[A-Za-z][A-Za-z0-9_.:-]*',original_id) and original_id not in existing_ids else ''
            if alias: existing_ids.add(original_id)
            blocks.append({'kind':kind,'html':f'<div id="{source_id}">{alias}{content}</div>','pdfPages':pages,'sourceId':source_id,'ocrSourceId':original_id})
        if set(p for b in blocks for p in b['pdfPages']) != set(range(1,page_count+1)): raise ValueError('Reviewed OCR body omits a source page')
        native_characters = sum(len(p.chars) for p in pdf.pages)
    body = ''.join(b['html'] for b in blocks)
    document = '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>'+html.escape(title)+'</title><style>body{max-width:1000px;margin:32px auto;padding:0 24px;font:18px/1.65 Georgia,serif}img{max-width:100%;height:auto}table{border-collapse:collapse;width:100%}td,th{border:1px solid #bbb;padding:8px}math[display="block"]{display:block;margin:1em 0}</style></head><body><h1>'+html.escape(title)+'</h1><article>'+body+'</article></body></html>\n'
    for filename in ['source.html','en.html']: (out/filename).write_text(document)
    conversion = {'version':VERSION,'converterScript':{'name':'papero/convert-reviewed-ocr.py','sha256':digest(pathlib.Path(__file__).read_bytes())},
        'inputPdf':{'sha256':digest(pdf_bytes),'bytes':len(pdf_bytes)},'recipeSha256':digest(recipe_bytes),'englishHtmlSha256':digest(document.encode()),
        'pdfplumber':pdfplumber.__version__,'pypdf':pypdf.__version__,'blocks':blocks,'assets':assets,'resolvedDestinations':{},
        'ocr':{**recipe['ocr'],'sourceBlocksSha256':digest(raw_blocks),'reviewSha256':digest(review_bytes)},
        'coverage':{'missing':0,'duplicate':0,'sourceCharacters':native_characters,'excludedSourceCharacters':0,'excludedReason':'No native text layer characters excluded; raster completeness is established separately by the hash-bound full-page OCR review receipt.','pageCount':page_count}}
    (out/'conversion.json').write_text(json.dumps(conversion,ensure_ascii=False,indent=2)+'\n')
    print(f'Assembled {page_count} reviewed OCR pages, {len(blocks)} semantic blocks, {len(assets)} source crops; native text-layer characters: {native_characters}.')

if __name__ == '__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--pdf',required=True);parser.add_argument('--blocks',required=True);parser.add_argument('--review',required=True);parser.add_argument('--recipe',required=True);parser.add_argument('--out-dir',required=True);args=parser.parse_args()
    convert(*[pathlib.Path(x) for x in [args.pdf,args.blocks,args.review,args.recipe,args.out_dir]])
