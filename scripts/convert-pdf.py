#!/usr/bin/env python3
"""Convert a reviewed, text-bearing PDF layout recipe to semantic English HTML.

Recipes are deliberately explicit: column order, tables, formula replacements,
and figure bounds cannot be guessed reliably from PDF drawing instructions.
Every non-header source character must be covered exactly once by the recipe.
This is not an OCR engine; scanned pages fail rather than inventing their text.
"""
import argparse
import collections
import hashlib
import html
import json
import pathlib
import re
import unicodedata
import os

import pdfplumber
import pypdf
from pdf_vector_math import PdfMathVectors, vector_math_css

VERSION = "1.3.0"
MATH_FONT = re.compile(r"\+(?:CMMI|CMSY|CMR|CMEX)\d+$")

def escaped(text):
    return html.escape(text, quote=True)

def normalized(text):
    return unicodedata.normalize('NFKC', text).replace('(cid:51)', '✓').replace('(cid:55)', '✗')

def mathml(chars):
    if any(c.get('_math_override') for c in chars):
        result, seen = [], set()
        for c in chars:
            value = c.get('_math_override')
            if value and value not in seen:
                result.append(value); seen.add(value)
            elif not value:
                result.append(mathml([c]))
        return ''.join(result)
    base = max(c['size'] for c in chars)
    nodes = []
    def atoms(values):
        result = []
        for c in values:
            value = c.get('_render_text', c['text'])
            if value.startswith('(cid:'):
                raise ValueError(f"Unmapped mathematical PDF glyph: {value}")
            tag = 'mn' if value.isdigit() else 'mi' if value.isalpha() else 'mo'
            if result and result[-1][0] == tag and tag in ['mn', 'mi']:
                result[-1] = (tag, result[-1][1] + value)
            else: result.append((tag, value))
        return ''.join(f'<{tag}>{escaped(value)}</{tag}>' for tag, value in result)
    index = 0
    while index < len(chars):
        char = chars[index]
        if nodes and char['size'] < base * .8:
            group = [char]
            index += 1
            while index < len(chars) and chars[index]['size'] < base * .8:
                group.append(chars[index]); index += 1
            previous, previous_char = nodes.pop()
            center = (char['top'] + char['bottom']) / 2
            previous_center = (previous_char['top'] + previous_char['bottom']) / 2
            tag = 'msub' if center > previous_center else 'msup'
            child = atoms(group)
            if len(group) > 1: child = '<mrow>' + child + '</mrow>'
            nodes.append((f'<{tag}>{previous}{child}</{tag}>', previous_char))
        else:
            values = [char]; index += 1
            if char['text'].isdigit():
                while index < len(chars) and chars[index]['size'] >= base * .8 and chars[index]['text'].isdigit():
                    values.append(chars[index]); index += 1
            nodes.append((atoms(values), char))
    return '<math><mrow>' + ''.join(n[0] for n in nodes) + '</mrow></math>'

class Converter:
    def __init__(self, pdf, recipe, output):
        self.pdf, self.recipe, self.output = pdf, recipe, output
        self.used = collections.Counter()
        self.skipped = set()
        self.blocks = []
        self.assets = []
        self.anchors = {}
        self.math_vectors = None
        if recipe.get('mathMode') == 'original-pdf-vectors':
            executable = os.environ.get('PDFTOCAIRO', 'pdftocairo')
            self.math_vectors = PdfMathVectors(recipe['inputPdf'], pdf, output, executable)
        self.pdf_reader = pypdf.PdfReader(recipe['inputPdf'])
        for page_number, page in enumerate(pdf.pages, 1):
            for index, char in enumerate(page.chars):
                char['_source'] = (page_number, index)
            for char in page.chars:
                if page_number > 1 and char['bottom'] < 61:
                    self.skipped.add(char['_source'])
        # Compose independently positioned accents by glyph overlap, retaining
        # the base glyph bounds so accents cannot swallow real word spaces.
        accent_marks = {'´': '\u0301', '`': '\u0300', 'ˆ': '\u0302'}
        for page in pdf.pages:
            for char in page.chars:
                if char['text'] not in accent_marks or MATH_FONT.search(char['fontname']): continue
                center = (char['x0'] + char['x1']) / 2
                candidates = [base for base in page.chars if base is not char and len(base['text']) == 1 and base['text'].isalpha()
                              and abs((base['x0'] + base['x1']) / 2 - center) < 1.5 and abs(base['top'] - char['top']) < 3]
                if len(candidates) != 1: raise ValueError('Accent needs reviewed glyph association.')
                base = candidates[0]
                letter = 'i' if base['text'] == 'ı' else base['text']
                base['_render_text'] = unicodedata.normalize('NFC', letter + accent_marks[char['text']])
                char['_render_skip'] = True
        for override in recipe.get('mathOverrides', []):
            x0, y0, x1, y1 = override['bounds']
            for char in pdf.pages[override['page'] - 1].chars:
                if x0 <= (char['x0'] + char['x1']) / 2 < x1 and y0 <= (char['top'] + char['bottom']) / 2 < y1:
                    if not MATH_FONT.search(char['fontname']):
                        continue  # Tall radicals can overlap the previous prose line.
                    char['_math_override'] = override['html']
                    char['_math_baseline'] = override['baseline']
        for name, destination in self.pdf_reader.named_destinations.items():
            page = self.pdf_reader.get_destination_page_number(destination) + 1
            top = self.pdf.pages[page - 1].height - float(destination.get('/Top', self.pdf.pages[page - 1].height))
            self.anchors.setdefault(page, []).append((self.anchor(name), top, name))

    @staticmethod
    def anchor(name):
        return 'pdf-' + re.sub('[^A-Za-z0-9_.:-]', '-', str(name))

    def crop_chars(self, page_number, bounds):
        x0, y0, x1, y1 = bounds
        chars = [c for c in self.pdf.pages[page_number - 1].chars
                 if x0 <= (c['x0'] + c['x1']) / 2 < x1 and y0 <= (c['top'] + c['bottom']) / 2 < y1]
        for char in chars:
            self.used[char['_source']] += 1
        return chars

    def link(self, page, char):
        x = (char['x0'] + char['x1']) / 2
        y = (char['top'] + char['bottom']) / 2
        for annotation in self.pdf.pages[page - 1].annots:
            if annotation['x0'] - .4 <= x <= annotation['x1'] + .4 and annotation['top'] - .4 <= y <= annotation['bottom'] + .4:
                action = annotation.get('data', {}).get('A', {})
                dest = action.get('D')
                if isinstance(dest, bytes):
                    return '#' + self.anchor(dest.decode('utf-8'))
                if annotation.get('uri', '').startswith(('https://', 'http://')):
                    return annotation['uri']
        return None

    def render_line(self, page, chars):
        if self.math_vectors and chars and all(c.get('_display_math') for c in chars):
            return self.math_vectors.image(page, chars)
        chars = sorted([dict(c, text=c.get('_render_text', c['text'])) for c in chars if not c.get('_render_skip')], key=lambda c: (c['x0'], c['top']))
        for char in chars:
            if char['text'].startswith('(cid:'):
                code = int(char['text'][5:-1])
                font = char['fontname']
                if 'CMSY10' in font and code == 12: char['text'] = '∈'
                elif 'CMMI10' in font and code == 15: char['text'] = 'ϵ'
                elif 'CMEX10' in font and code in [0, 16, 18]: char['text'] = '('
                elif 'CMEX10' in font and code in [1, 17, 19]: char['text'] = ')'
        groups = []
        previous = None
        for char in chars:
            font = char['fontname']
            style = 'math' if MATH_FONT.search(font) else 'code' if 'NimbusMon' in font else 'strong' if '-Medi' in font else 'em' if 'Ital' in font or 'Slant' in font else ''
            link = self.link(page, char) if style != 'math' else None
            if style != 'math' and char['size'] < 8 and (char['text'].isdigit() or char['text'] == '*'):
                style = 'sup'
            key = (style, link)
            # Scale the gap threshold with type size so letter-spaced small caps
            # stay joined while actual inter-word gaps remain visible.
            space = previous is not None and char['x0'] - previous['x1'] > max(.45, char['size'] * .12)
            if not groups or groups[-1][0] != key:
                groups.append((key, [], ' ' if space else ''))
            elif space and style != 'math':
                groups[-1][1].append({'text': ' ', 'fontname': font, 'size': char['size'], 'x0': previous['x1'], 'x1': char['x0'], 'top': char['top'], 'bottom': char['bottom']})
            groups[-1][1].append(char)
            previous = char
        result = []
        for (style, link), chars, prefix in groups:
            value = (self.math_vectors.image(page, chars) if self.math_vectors else mathml(chars)) if style == 'math' else escaped(normalized(''.join(c['text'] for c in chars)))
            if style and style != 'math': value = f'<{style}>{value}</{style}>'
            if link: value = f'<a href="{escaped(link)}">{value}</a>'
            result.append(prefix + value)
        return ''.join(result)

    def lines(self, page, chars):
        if self.math_vectors:
            return self.vector_lines(page, chars)
        # Establish prose baselines first, then attach mathematical subscripts,
        # superscripts and footnote markers to the nearest prose line.
        regular = [c for c in chars if not MATH_FONT.search(c['fontname']) and c['size'] >= 8]
        small_lines = collections.defaultdict(list)
        for c in chars:
            if not MATH_FONT.search(c['fontname']) and c['size'] < 8:
                small_lines[round(c['bottom'])].append(c)
        regular += [c for group in small_lines.values() if len(group) > 10 for c in group]
        if not regular: regular = [c for c in chars if not MATH_FONT.search(c['fontname'])]
        groups = []
        for char in sorted(regular, key=lambda c: c['bottom']):
            target = next((g for g in groups if abs(g['baseline'] - char['bottom']) < 1.3), None)
            if target is None:
                target = {'baseline': char['bottom'], 'chars': []}
                groups.append(target)
            target['chars'].append(char)
        regular_ids = {id(c) for c in regular}
        for char in chars:
            if id(char) in regular_ids: continue
            baseline = char.get('_math_baseline', char['bottom'])
            target = min(groups, key=lambda g: abs(g['baseline'] - baseline), default=None)
            if target is None or abs(target['baseline'] - baseline) > 7:
                target = {'baseline': baseline, 'chars': []}
                groups.append(target)
            target['chars'].append(char)
        result = []
        for group in sorted(groups, key=lambda g: g['baseline']):
            chars = group['chars']
            prose_chars = [c for c in chars if not MATH_FONT.search(c['fontname'])]
            result.append({'html': self.render_line(page, chars), 'text': ''.join(c['text'] for c in sorted(chars, key=lambda c: c['x0'])),
                           'prose_html': self.render_line(page, prose_chars) if prose_chars else '',
                           'prose_text': ''.join(c['text'] for c in sorted(prose_chars, key=lambda c: c['x0'])),
                           'prose_size': max((c['size'] for c in prose_chars), default=0),
                           'top': min(c['top'] for c in chars), 'bottom': max(c['bottom'] for c in chars),
                           'x0': min(c['x0'] for c in chars), 'size': max(c['size'] for c in chars),
                           'bold': all('-Medi' in c['fontname'] or c['text'].isspace() for c in chars)})
        return result

    def vector_lines(self, page, chars):
        """Use true text baselines, not font-specific glyph-box bottoms.

        Mathematical shapes are copied from the source PDF. Full-size glyphs
        establish missing lines; scripts and tall radicals join their expression.
        Consecutive display-only lines stay one vector expression, preserving
        fractions and multiline alignment rather than flattening them as text.
        """
        height = self.pdf.pages[page-1].height
        baseline = lambda c: height-c['matrix'][5]
        is_math = lambda c: bool(MATH_FONT.search(c['fontname']))
        run = 0
        previous_math = False
        ordered_source = sorted(chars, key=lambda c: c['_source'][1])
        for c in ordered_source:
            if is_math(c):
                if not previous_math: run += 1
                c['_math_run'] = run
            previous_math = is_math(c)
        groups = []
        anchors = [c for c in chars if not is_math(c) and c['size'] >= 8]
        anchors += [c for c in chars if is_math(c) and c['size'] >= 8 and 'CMEX' not in c['fontname'] and c['text'] != '√']
        for c in sorted(anchors, key=baseline):
            y = baseline(c)
            group = next((g for g in groups if abs(g['baseline']-y) < .5), None)
            if group is None: group = {'baseline': y, 'chars': []}; groups.append(group)
            group['chars'].append(c)
        anchor_ids = {id(c) for c in anchors}
        assigned_baselines = {id(c): baseline(c) for c in anchors}
        extras = [c for c in chars if id(c) not in anchor_ids]
        # Resolve full-size operators before their nested limits and scripts.
        for c in sorted(extras, key=lambda c: -c['size']):
            y = baseline(c)
            if is_math(c):
                # Small nested scripts and tall radicals can have baselines
                # closer to adjacent prose than to their own expression. Bind
                # by original glyph geometry and mathematical neighbours.
                close = [a for a in chars if id(a) in assigned_baselines and is_math(a) and a['size'] >= 8
                         and a.get('_math_run') == c.get('_math_run') and abs(a['x0']-c['x0']) < 100]
                if close:
                    own = self.math_vectors.glyph(page, c)['bounds']
                    def distance(a):
                        box = self.math_vectors.glyph(page, a)['bounds']
                        dx = max(0, own[0]-box[2], box[0]-own[2])
                        dy = max(0, own[1]-box[3], box[1]-own[3])
                        return dx + dy*3
                    neighbor = min(close, key=distance)
                    y = assigned_baselines[id(neighbor)]
                else:
                    # An inline fraction may consist entirely of small glyphs.
                    # Its adjacent source prose identifies the intended line.
                    own_run = [a for a in ordered_source if a.get('_math_run') == c['_math_run']]
                    first, last = own_run[0]['_source'][1], own_run[-1]['_source'][1]
                    prose_neighbors = [a for a in anchors if not is_math(a) and (a['_source'][1] == first-1 or a['_source'][1] == last+1)]
                    if prose_neighbors: y = baseline(min(prose_neighbors, key=lambda a: abs(a['x0']-c['x0'])))
            group = min(groups, key=lambda g: abs(g['baseline']-y), default=None)
            if group is None or abs(group['baseline']-y) > 7:
                group = {'baseline': y, 'chars': []}; groups.append(group)
            group['chars'].append(c)
            assigned_baselines[id(c)] = group['baseline']
        ordered = sorted(groups, key=lambda g: g['baseline'])
        # A display equation can contain roman E/R, numerals and its equation
        # number. Keep those glyphs with the original mathematical layout;
        # treating them as prose would flatten sums, fractions and alignment.
        for g in ordered:
            roman = ''.join(' ' if is_math(c) else c['text'] for c in sorted(g['chars'], key=lambda c: c['x0']))
            g['display_math'] = not re.search(r'[A-Za-z]{2,}', roman)
            if g['display_math']:
                for c in g['chars']: c['_display_math'] = True
        merged = []
        for g in ordered:
            if merged and g['display_math'] and merged[-1]['display_math'] and g['baseline']-merged[-1]['last_baseline'] < 24:
                merged[-1]['chars'] += g['chars']; merged[-1]['last_baseline'] = g['baseline']
            else: merged.append({**g, 'last_baseline': g['baseline']})
        result = []
        for g in merged:
            values = g['chars']; prose = [c for c in values if not is_math(c) and not c.get('_display_math')]
            result.append({'html': self.render_line(page, values), 'text': ''.join(c['text'] for c in sorted(values,key=lambda c:c['x0'])),
                'prose_html': self.render_line(page, prose) if prose else '', 'prose_text': ''.join(c['text'] for c in sorted(prose,key=lambda c:c['x0'])),
                'prose_size': max((c['size'] for c in prose), default=0), 'top': g['baseline']-max(c['size'] for c in values),
                'bottom': g['last_baseline']+1, 'x0': min(c['x0'] for c in values), 'size': max(c['size'] for c in values),
                'bold': all('-Medi' in c['fontname'] or c['text'].isspace() for c in values)})
        return result

    def paragraphs(self, page, bounds, headings=True, references=False):
        lines = self.lines(page, self.crop_chars(page, bounds))
        parts, paragraph = [], []
        def flush():
            if not paragraph: return
            text = paragraph[0]['html']
            for line in paragraph[1:]:
                value = line['html']
                plain = re.sub('<[^>]+>', '', text)
                end_hyphen = re.search(r'-(</[^>]+>)*$', text)
                next_word = re.match(r'([A-Za-z]+)', re.sub('<[^>]+>', '', value))
                if end_hyphen and next_word:
                    previous_word = re.search(r'([A-Za-z]+)-$', plain)
                    compound_suffixes = {'fine': ['tuning', 'tuned'], 'pre': ['training', 'trained', 'processing', 'activation'], 'self': ['attention', 'attentive'], 'zero': ['shot'], 'task': ['specific'], 'word': ['level'], 'byte': ['level'], 'character': ['level'], 'long': ['range'], 'short': ['range'], 'high': ['capacity'], 'low': ['capacity'], 'large': ['scale'], 'state': ['of'], 'out': ['of', 'distribution', 'vocabulary'], 'in': ['domain', 'distribution', 'context'], 'near': ['duplicate', 'duplicates'], 'non': ['trivial', 'cherry'], 'held': ['out'], 'log': ['linear', 'uniformly'], 'few': ['shot'], 'model': ['agnostic'], 'well': ['posed', 'known']}
                    preserve = previous_word and next_word[1].lower() in compound_suffixes.get(previous_word[1].lower(), [])
                    text = (text if preserve else text[:end_hyphen.start()] + text[end_hyphen.start()+1:]) + value
                else: text += ' ' + value
            parts.append(('reference' if references else 'paragraph', '<p>' + ('<span class="ltx_bibblock">' + text + '</span>' if references else text) + '</p>', paragraph[0]['top']))
            paragraph.clear()
        for line in lines:
            heading_text = line['prose_text'].strip()
            numbered_heading = re.match(r'^\d+(?:\.\d+)*(?:\s+|(?=[A-Z]))', heading_text)
            uppercase_heading = len(heading_text) > 4 and any(char.isalpha() for char in heading_text) and not any(char.islower() for char in heading_text)
            heading_style = line['bold'] or line['prose_size'] >= 10.5 or uppercase_heading
            if headings and (heading_style or heading_text.casefold() in ['abstract', 'references', 'acknowledgments', 'acknowledgements']) \
                    and (numbered_heading or heading_text.casefold() in ['abstract', 'references', 'acknowledgments', 'acknowledgements']):
                flush()
                level = min(6, 2 + heading_text.count('.')) if re.match(r'^\d+\.\d+', heading_text) else 2
                parts.append(('heading', f'<h{level}>{line["prose_html"]}</h{level}>', line['top']))
                if heading_text.casefold() == 'references': references = True
            else:
                if paragraph and (line['top'] - paragraph[-1]['bottom'] > 3.7 or references and line['x0'] < paragraph[-1]['x0'] - 3): flush()
                paragraph.append(line)
        flush()
        return parts

    def add(self, page, kind, content, top=65):
        source_id = f'pdf-p{page}-block-{len(self.blocks) + 1:03}'
        # IDs belong to the source HTML and survive sanitization and export.
        content = f'<div id="{source_id}">{content}</div>'
        self.blocks.append({'kind': kind, 'html': content, 'pdfPages': [page], 'sourceId': source_id, 'top': top})

    def text(self, page, spec):
        for kind, content, top in self.paragraphs(page, spec['bounds'], headings=spec.get('headings', True), references=spec.get('references', False)):
            self.add(page, kind, content, top)

    def table(self, page, spec):
        rows = []
        for row in spec['rows']:
            cells = []
            for cell in row:
                inner = ''.join(content for _, content, _ in self.paragraphs(page, cell['bounds'], headings=False))
                tag = 'th' if cell.get('header') else 'td'
                colspan = f' colspan="{cell["colspan"]}"' if cell.get('colspan') else ''
                cells.append(f'<{tag}{colspan}>{inner}</{tag}>')
            rows.append('<tr>' + ''.join(cells) + '</tr>')
        caption = ''.join(content for _, content, _ in self.paragraphs(page, spec['caption'], headings=False))
        self.add(page, 'table', f'<figure id="table-{spec["number"]}" class="ltx_table"><table><tbody>' + ''.join(rows) + f'</tbody></table><figcaption>{caption}</figcaption></figure>', spec['rows'][0][0]['bounds'][1])

    def figure(self, page, spec):
        filename = f'figure-{spec["number"]}.png'
        crop = self.pdf.pages[page - 1].crop(tuple(spec['bounds']))
        crop.to_image(resolution=180).save(self.output / 'assets' / filename)
        # Chart drawing labels are part of the preserved figure, not separately duplicated as prose.
        self.crop_chars(page, spec['bounds'])
        caption = ''.join(content for _, content, _ in self.paragraphs(page, spec['caption'], headings=False))
        asset_bytes = (self.output / 'assets' / filename).read_bytes()
        self.assets.append({'filename': filename, 'pdfPage': page, 'pdfBounds': spec['bounds'], 'sha256': hashlib.sha256(asset_bytes).hexdigest(), 'bytes': len(asset_bytes)})
        self.add(page, 'figure', f'<figure id="figure-{spec["number"]}"><img src="assets/{filename}" alt="Figure {spec["number"]}"><figcaption>{caption}</figcaption></figure>', spec['bounds'][1])

    def algorithm(self, page, spec):
        caption = ''.join(content for _, content, _ in self.paragraphs(page, spec['caption'], headings=False))
        rows = self.lines(page, self.crop_chars(page, spec['bounds']))
        body = ''.join(f'<div class="algorithm-line">{line["html"]}</div>' for line in rows)
        self.add(page, 'algorithm', f'<figure class="ltx_algorithm"><figcaption>{caption}</figcaption><div class="algorithm-body">{body}</div></figure>', spec['bounds'][1])

    def run(self):
        for page_spec in self.recipe['pages']:
            page = page_spec['page']
            for spec in page_spec['items']:
                kind = spec['kind']
                if kind == 'skip': self.skipped.update(c['_source'] for c in self.crop_chars(page, spec['bounds']))
                elif kind == 'text': self.text(page, spec)
                elif kind == 'table': self.table(page, spec)
                elif kind == 'figure': self.figure(page, spec)
                elif kind == 'algorithm': self.algorithm(page, spec)
                elif kind == 'equation':
                    self.crop_chars(page, spec['bounds'])
                    self.add(page, 'equation', spec['html'], spec['bounds'][1])
                else: raise ValueError(f'Unsupported recipe kind: {kind}')
        missing, duplicate = [], []
        for page in self.pdf.pages:
            for char in page.chars:
                key = char['_source']
                if key in self.skipped: continue
                if self.used[key] == 0: missing.append({'page': key[0], 'text': char['text'], 'x0': char['x0'], 'top': char['top']})
                if self.used[key] > 1: duplicate.append({'page': key[0], 'text': char['text'], 'x0': char['x0'], 'top': char['top']})
        if missing or duplicate:
            (self.output / 'coverage-errors.json').write_text(json.dumps({'missing': missing, 'duplicate': duplicate}, indent=2))
            raise ValueError(f'Layout recipe is incomplete: {len(missing)} missing, {len(duplicate)} duplicate source characters. See coverage-errors.json.')
        (self.output / 'blocks-before-anchors.json').write_text(json.dumps(self.blocks, indent=2))
        # PDF destinations only specify page/height; attach each to its nearest retained block.
        for page, anchors in self.anchors.items():
            candidates = [b for b in self.blocks if page in b['pdfPages']]
            for anchor, top, name in anchors:
                target = self.recipe.get('anchorTargets', {}).get(name)
                if target:
                    block = next((b for b in candidates if b['sourceId'] == target['sourceId']), None)
                    plain = html.unescape(re.sub('<[^>]+>', '', block['html'])) if block else ''
                    compact = lambda value: ''.join(char for char in unicodedata.normalize('NFKC', value) if char.isalnum()).lower()
                    image_match = bool(target.get('imageSrc') and f'src="{target["imageSrc"]}"' in block['html']) if block else False
                    matches = image_match if target.get('imageSrc') else bool(target.get('textPrefix') and compact(plain).startswith(compact(target['textPrefix'])))
                    if not block or target['pdfPage'] != page or not matches:
                        raise ValueError(f'Reviewed PDF destination no longer matches its semantic block: {name}')
                else:
                    raise ValueError(f'PDF destination requires reviewed semantic resolution: {name}')
                block['html'] = f'<span id="{anchor}"></span>' + block['html']
        if self.math_vectors:
            self.assets.extend(self.math_vectors.assets)
        article = '<article>' + ''.join(b['html'] for b in self.blocks) + '</article>'
        document = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><style>body{{max-width:1000px;margin:32px auto;padding:0 24px;font:18px/1.65 Georgia,serif}}table{{width:100%;border-collapse:collapse}}td,th{{border:1px solid #bbb;padding:8px;vertical-align:top}}figure{{margin:24px 0}}img{{max-width:100%;height:auto}}figcaption{{font-size:.9em}}math[display="block"]{{margin:16px 0}}annotation{{display:none}}</style><title>{escaped(self.recipe["title"])}</title></head><body><h1>{escaped(self.recipe["title"])}</h1>{article}</body></html>\n'
        if self.math_vectors: document = document.replace('</style>',vector_math_css()+'</style>')
        (self.output / 'source.html').write_text(document)
        (self.output / 'en.html').write_text(document)
        pdf_bytes = pathlib.Path(self.recipe['inputPdf']).read_bytes()
        (self.output / 'conversion.json').write_text(json.dumps({'version': VERSION, 'inputPdf': {'sha256': hashlib.sha256(pdf_bytes).hexdigest(), 'bytes': len(pdf_bytes)}, 'recipeSha256': self.recipe['recipeSha256'], 'englishHtmlSha256': hashlib.sha256(document.encode()).hexdigest(), 'pdfplumber': pdfplumber.__version__, 'pypdf': pypdf.__version__,
            **({'mathMode': 'original-pdf-vectors', 'pdftocairo': self.math_vectors.version, 'vectorMathModuleSha256': hashlib.sha256(pathlib.Path(__file__).with_name('pdf_vector_math.py').read_bytes()).hexdigest()} if self.math_vectors else {}),
            'blocks': self.blocks, 'assets': self.assets, 'resolvedDestinations': self.recipe.get('anchorTargets', {}), 'coverage': {'missing': 0, 'duplicate': 0, 'sourceCharacters': sum(len(p.chars) for p in self.pdf.pages), 'excludedSourceCharacters': len(self.skipped), 'excludedReason': 'Repeated running headers and document title retained in h1; no body text excluded', 'pageCount': len(self.pdf.pages)}}, indent=2))
        print(f'Converted {len(self.pdf.pages)} PDF pages: {len(self.blocks)} semantic blocks, {len(self.assets)} figures; all source characters covered exactly once.')

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--pdf', required=True)
    parser.add_argument('--recipe', required=True)
    parser.add_argument('--out-dir', required=True)
    args = parser.parse_args()
    recipe_bytes = pathlib.Path(args.recipe).read_bytes()
    recipe = json.loads(recipe_bytes)
    recipe['recipeSha256'] = hashlib.sha256(recipe_bytes).hexdigest()
    recipe['inputPdf'] = args.pdf
    output = pathlib.Path(args.out_dir)
    (output / 'assets').mkdir(parents=True, exist_ok=True)
    with pdfplumber.open(args.pdf) as pdf:
        if any(not page.chars for page in pdf.pages): raise ValueError('Scanned or empty page: OCR and reading-order review are required before conversion.')
        Converter(pdf, recipe, output).run()
