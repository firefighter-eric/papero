"""Preserve unextractable PDF mathematics as original glyph outlines, not OCR.

This optional fallback is for PDFs whose embedded font mappings and positioned
scripts cannot safely be reconstructed as MathML. Prose remains semantic HTML.
Only selected mathematical glyphs and their fraction/radical rules are retained.
"""
import copy
import collections
import hashlib
import pathlib
import re
import subprocess
import xml.etree.ElementTree as ET

SVG = 'http://www.w3.org/2000/svg'
XLINK = 'http://www.w3.org/1999/xlink'
ET.register_namespace('', SVG)
ET.register_namespace('xlink', XLINK)

def path_bounds(value):
    # Cairo emits absolute M/L/C/Z paths. Control points conservatively bound
    # cubic curves, which prevents clipping even at fractional glyph positions.
    if re.search(r'[a-zA-BD-KN-Y]', value):
        raise ValueError('Unsupported Cairo path geometry')
    numbers = [float(x) for x in re.findall(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?', value)]
    if not numbers: return None
    if len(numbers) % 2: raise ValueError('Odd Cairo path coordinate count')
    return min(numbers[::2]), min(numbers[1::2]), max(numbers[::2]), max(numbers[1::2])

def union(bounds):
    return min(b[0] for b in bounds), min(b[1] for b in bounds), max(b[2] for b in bounds), max(b[3] for b in bounds)

def nearby(grid, x, y):
    return [u for ix in range(int(x)-2,int(x)+3) for iy in range(int(y)-2,int(y)+3) for u in grid.get((ix,iy), [])]

def multiply(a,b):
    return (a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5])

def transformed(box,m):
    points=[(m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]) for x,y in [(box[0],box[1]),(box[0],box[3]),(box[2],box[1]),(box[2],box[3])]]
    return min(p[0] for p in points),min(p[1] for p in points),max(p[0] for p in points),max(p[1] for p in points)

def transform_value(value):
    if not value: return (1,0,0,1,0,0)
    if not value.startswith('matrix('): raise ValueError('Unsupported Cairo transform')
    values=tuple(float(v) for v in re.findall(r'-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?',value))
    if len(values)!=6: raise ValueError('Invalid Cairo transform')
    return values

def matrix_text(matrix):
    return 'matrix('+','.join(f'{n:.9f}' for n in matrix)+')'

class PdfMathVectors:
    def __init__(self, pdf_path, pdf, output, executable):
        self.pdf, self.output = pdf, output
        self.pages, self.assets, self.counter = {}, [], 0
        self.executable = executable
        self.version = subprocess.run([executable, '-v'], check=True, capture_output=True, text=True, timeout=15).stderr.strip().splitlines()[0]
        for number, page in enumerate(pdf.pages, 1):
            filename = output / f'vector-source-page-{number:02}.svg'
            subprocess.run([executable, '-f', str(number), '-l', str(number), '-svg', str(pdf_path), str(filename)], check=True, capture_output=True, timeout=60)
            tree = ET.parse(filename).getroot()
            definitions = {node.get('id'): node for node in tree.find(f'{{{SVG}}}defs').iter() if node.get('id')}
            uses, rules = [], []
            def walk(node, matrix=(1,0,0,1,0,0), ancestors=()):
                matrix=multiply(matrix,transform_value(node.get('transform','')))
                if node.tag==f'{{{SVG}}}use':
                    identifier=node.get(f'{{{XLINK}}}href',node.get('href'))[1:]
                    if identifier in ancestors: raise ValueError('Cyclic Cairo vector reference')
                    matrix=multiply(matrix,(1,0,0,1,float(node.get('x',0)),float(node.get('y',0))))
                    if identifier.startswith('glyph-'):
                        shapes=[path_bounds(p.get('d','')) for p in definitions[identifier].iter(f'{{{SVG}}}path')]
                        shapes=[b for b in shapes if b]
                        if shapes:
                            use=ET.Element(f'{{{SVG}}}use',{f'{{{XLINK}}}href':'#'+identifier,'transform':matrix_text(matrix)})
                            uses.append({'node':use,'symbol':identifier,'x':matrix[4],'y':matrix[5],'bounds':transformed(union(shapes),matrix)})
                    else: walk(definitions[identifier],matrix,ancestors+(identifier,))
                elif node.tag==f'{{{SVG}}}path':
                    box=path_bounds(node.get('d',''))
                    if box:
                        shape=copy.deepcopy(node);shape.set('transform',matrix_text(matrix));rules.append((shape,transformed(box,matrix)))
                else:
                    for child in node:
                        if child.tag!=f'{{{SVG}}}defs': walk(child,matrix,ancestors)
            walk(tree)
            votes = collections.defaultdict(collections.Counter)
            grid = collections.defaultdict(list)
            for u in uses: grid[(int(u['x']),int(u['y']))].append(u)
            for c in page.chars:
                x, y = c['matrix'][4], page.height-c['matrix'][5]
                close = sorted(nearby(grid,x,y), key=lambda u: (u['x']-x)**2+(u['y']-y)**2)[:2]
                if close and (close[0]['x']-x)**2+(close[0]['y']-y)**2 < 2 and (len(close)<2 or (close[1]['x']-x)**2+(close[1]['y']-y)**2 > 2):
                    votes[c['fontname']][close[0]['symbol'].split('-')[1]] += 1
            families = {font: counts.most_common(1)[0][0] for font,counts in votes.items()}
            self.pages[number] = {'defs': definitions, 'uses': uses, 'grid': grid, 'rules': rules, 'cache': {}, 'families': families}

    def glyph(self, page_number, char):
        page, data = self.pdf.pages[page_number-1], self.pages[page_number]
        key = char['_source']
        if key in data['cache']: return data['cache'][key]
        x, y = char['matrix'][4], page.height-char['matrix'][5]
        family = data['families'].get(char['fontname'])
        candidates = sorted([u for u in nearby(data['grid'],x,y) if (family is None or u['symbol'].split('-')[1] == family) and abs(u['x']-x) < 2 and abs(u['y']-y) < 2],
                            key=lambda u:(u['x']-x)**2+(u['y']-y)**2)
        if not candidates or (len(candidates)>1 and abs((candidates[1]['x']-x)**2+(candidates[1]['y']-y)**2-((candidates[0]['x']-x)**2+(candidates[0]['y']-y)**2)) < .02):
            raise ValueError(f'PDF mathematical glyph has no unique vector counterpart: page {page_number}, {char["text"]}, {x}, {y}')
        data['cache'][key] = candidates[0]
        return candidates[0]

    def image(self, page_number, chars):
        glyphs = [self.glyph(page_number, c) for c in chars]
        if not glyphs: return ''
        x0, y0, x1, y1 = union([g['bounds'] for g in glyphs])
        x0-=.3; y0-=.3; x1+=.3; y1+=.3
        data = self.pages[page_number]
        svg = ET.Element(f'{{{SVG}}}svg', {'viewBox': f'{x0:.5f} {y0:.5f} {x1-x0:.5f} {y1-y0:.5f}',
            'width': str(x1-x0), 'height': str(y1-y0)})
        ET.SubElement(svg, f'{{{SVG}}}title').text = f'Original mathematical expression, PDF page {page_number}'
        defs = ET.SubElement(svg, f'{{{SVG}}}defs')
        for identifier in sorted({g['symbol'] for g in glyphs}): defs.append(copy.deepcopy(data['defs'][identifier]))
        group = ET.SubElement(svg, f'{{{SVG}}}g', {'fill': '#000000'})
        for g in glyphs: group.append(copy.deepcopy(g['node']))
        for shape, b in data['rules']:
            if x0-.5 <= b[0] and b[2] <= x1+.5 and y0-.5 <= b[1] and b[3] <= y1+.5:
                group.append(copy.deepcopy(shape))
        self.counter += 1
        filename = f'math-p{page_number:02}-{self.counter:04}.svg'
        content = ET.tostring(svg, encoding='utf-8', xml_declaration=False)
        (self.output / 'assets' / filename).write_bytes(content)
        base = max(c['size'] for c in chars)
        height = max(3, min(300, round((y1-y0)/base*10)))
        self.assets.append({'filename': filename, 'pdfPage': page_number, 'pdfBounds': [x0,y0,x1,y1],
            'sha256': hashlib.sha256(content).hexdigest(), 'bytes': len(content), 'method': 'original-pdf-math-vectors',
            'glyphCount': len(chars), 'glyphSourceIndices': [c['_source'][1] for c in chars]})
        return f'<img class="pdf-math pdf-math-h{height}" src="assets/{filename}" alt="Mathematical expression from PDF page {page_number}" width="{(x1-x0)/base*18:.2f}" height="{(y1-y0)/base*18:.2f}">'

def vector_math_css():
    return '.pdf-math{display:inline-block;vertical-align:middle;width:auto;max-width:none;margin:0 .03em}' + ''.join(f'.pdf-math.pdf-math-h{i}{{height:{i/10:.1f}em}}' for i in range(3,301))
