"""Rebuild the V25 printed-heading WOFF2. Requires FontTools + Brotli and
the OFL Noto Sans SC variable font identified in the generated provenance.
Usage: python tools/build-v25-heading-font.py path/to/NotoSansSC-VF.ttf
"""
import base64, hashlib, json, sys
from pathlib import Path
from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

root = Path(__file__).resolve().parents[1]
fonts = root / 'fonts'
src = Path(sys.argv[1])
sha = lambda b: hashlib.sha256(b).hexdigest()
manifest = json.JSONDecoder().raw_decode((root / 'v25-original-data.js').read_text(encoding='utf8').split('const M=', 1)[1])[0]
source = json.JSONDecoder().raw_decode((root / 'data/bible-source.js').read_text(encoding='utf8').split('function(){return ', 1)[1])[0]
chars = set()
for book in source['books']:
    for chapter in book['chapters']:
        for _, title in chapter['titles']:
            chars.update(title)

def numbers(encoded):
    accum = shift = 0
    for byte in base64.b64decode(encoded):
        accum |= (byte & 127) << shift
        if byte & 128:
            shift += 7
        else:
            yield accum
            accum = shift = 0
    assert shift == 0

for file in manifest['packs'].values():
    for pair in json.loads((root / 'paper-pages' / file).read_text(encoding='utf8')).values():
        for page in filter(None, pair):
            pos = 0
            runs = numbers(manifest['pg'][str(page[0])][4])
            for count, code in zip(runs, runs):
                if manifest['roles'][code % 8] == 'heading':
                    for w in page[3][pos:pos+count]:
                        chars.update(w[4])
                pos += count
            assert pos == len(page[3])
font = TTFont(src, recalcTimestamp=False)
names = font['name']
origin = {str(i): names.getDebugName(i) for i in (0, 1, 5, 13)}
assert origin['1'] == 'Noto Sans SC' and 'SIL Open Font License' in origin['13']
cmap = font.getBestCmap()
missing = sorted(ord(c) for c in chars if ord(c) not in cmap and not c.isspace())
assert not missing, missing
options = subset.Options()
options.name_IDs = ['*']
options.name_languages = ['*']
sub = subset.Subsetter(options=options)
sub.populate(unicodes=[ord(c) for c in chars])
sub.subset(font)
instantiateVariableFont(font, {'wght':600}, inplace=True)
# A renamed, genuinely semibold static cut, not browser-synthesized bold.
rename = {1:'Paper Heading',2:'SemiBold',3:'PaperHeading600-V25',4:'Paper Heading SemiBold',6:'PaperHeading-SemiBold',16:'Paper Heading',17:'SemiBold'}
names = font['name']
for rec in list(names.names):
    if rec.nameID in rename:
        names.setName(rename[rec.nameID], rec.nameID, rec.platformID, rec.platEncID, rec.langID)
assert font['OS/2'].usWeightClass == 600
font.flavor = 'woff2'
from io import BytesIO
buf = BytesIO()
font.save(buf)
b = buf.getvalue()
filename = 'paper-heading-' + sha(b)[:12] + '.woff2'
(fonts / filename).write_bytes(b)
def put(name, data):
    (fonts / name).write_bytes(data.encode('utf8'))
put('paper-heading-OFL.txt', origin['0']+'\n\n'+(fonts/'LICENSE.txt').read_text(encoding='utf8').lstrip('\ufeff'))
put('paper-heading-provenance.json', json.dumps(dict(family='PaperHeading', file=filename, sourceFamily=origin['1'],sourceVersion=origin['5'], sourceSHA256=sha(src.read_bytes()),weight=600,coveredCodepoints=len(TTFont(BytesIO(b)).getBestCmap()),sha256=sha(b),license='paper-heading-OFL.txt'),ensure_ascii=False,indent=2)+'\n')
print(filename,len(b))
