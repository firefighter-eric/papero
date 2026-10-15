#!/usr/bin/env python3
"""Render narrowly specified missing graphics from hash-pinned source PDFs."""
import argparse, hashlib, json
from pathlib import Path
import pdfplumber

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--recipe', required=True)
    parser.add_argument('--pdf-root', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    recipe = json.loads(Path(args.recipe).read_text())
    receipts = []
    for paper in recipe['papers']:
        if not paper['crops']:
            continue
        source = Path(args.pdf_root) / paper['id'] / 'source.pdf'
        if hashlib.sha256(source.read_bytes()).hexdigest() != paper['sourcePdfSha256']:
            raise ValueError('PDF fingerprint mismatch: ' + paper['id'])
        target = Path(args.output) / paper['id']
        target.mkdir(parents=True, exist_ok=True)
        with pdfplumber.open(source) as pdf:
            for crop in paper['crops']:
                page = pdf.pages[crop['page'] - 1]
                image = page.crop(tuple(crop['bbox'])).to_image(resolution=crop['resolution'], antialias=True).original
                output = target / crop['filename']
                image.save(output, format='PNG', optimize=True)
                receipts.append({'paperId': paper['id'], **crop, 'sha256': hashlib.sha256(output.read_bytes()).hexdigest(), 'bytes': output.stat().st_size, 'pixelWidth': image.width, 'pixelHeight': image.height, 'tool': 'pdfplumber', 'toolVersion': pdfplumber.__version__, 'sourcePdfSha256': paper['sourcePdfSha256']})
    Path(args.output).mkdir(parents=True, exist_ok=True)
    (Path(args.output) / 'render-receipts.json').write_text(json.dumps(receipts, indent=2) + '\n')
    print(json.dumps({'rendered': len(receipts), 'output': args.output}))

if __name__ == '__main__':
    main()
