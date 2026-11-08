"""Generate portable width properties from Unicode 17 emoji-data/UnicodeData."""
from pathlib import Path
import hashlib
import sys
source = Path(sys.argv[1])
categories = Path(sys.argv[2])
target = Path(__file__).resolve().parents[1] / 'src' / 'emoji_tables.rs'
groups = {name: [] for name in ['Emoji', 'Emoji_Presentation', 'Emoji_Modifier_Base']}
for line in source.read_text().splitlines():
    fields = line.split('#', 1)[0].strip().split(';')
    if len(fields) != 2:
        continue
    code, prop = [field.strip() for field in fields]
    if prop not in groups:
        continue
    start, _, end = code.partition('..')
    groups[prop].append((int(start, 16), int(end or start, 16)))
marks = []
for line in categories.read_text().splitlines():
    fields = line.split(';')
    if len(fields) < 3 or fields[2] not in ['Mn', 'Mc', 'Me']:
        continue
    value = int(fields[0], 16)
    if marks and marks[-1][1] + 1 == value:
        marks[-1] = (marks[-1][0], value)
    else:
        marks.append((value, value))
groups['Marks'] = marks
text = '// Generated from Unicode 17 emoji-data.txt. SHA256 ' + hashlib.sha256(source.read_bytes()).hexdigest() + '\n'
text += '// UnicodeData.txt SHA256 ' + hashlib.sha256(categories.read_bytes()).hexdigest() + '\n'
for prop, values in groups.items():
    text += 'pub const ' + prop.upper() + ': &[(u32,u32)] = &[\n'
    text += ''.join(f' (0x{start:x},0x{end:x}),\n' for start, end in values)
    text += '];\n'
target.write_text(text)
