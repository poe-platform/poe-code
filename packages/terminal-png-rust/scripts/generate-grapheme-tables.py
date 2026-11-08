"""Generate std-only Unicode 17.0 property tables from published UCD inputs.

Usage: python3 scripts/generate-grapheme-tables.py <evidence-directory>
Inputs: rust-terminal-{grapheme,emoji,derived}-properties.txt
https://www.unicode.org/Public/17.0.0/ucd/{auxiliary/GraphemeBreakProperty.txt,
emoji/emoji-data.txt,DerivedCoreProperties.txt}
"""
from pathlib import Path
import hashlib
import sys
root = Path(__file__).resolve().parent.parent
evidence = Path(sys.argv[1])
labels = {'Regional_Indicator': 'RegionalIndicator', 'ZWJ': 'Zwj', 'LVT': 'Lvt'}
def read(name, property_name=None):
    path = evidence / ('rust-terminal-' + name + '-properties.txt')
    values = []
    for line in path.read_text().splitlines():
        parts = [part.strip() for part in line.split('#', 1)[0].split(';')]
        if len(parts) < 2 or not parts[0]:
            continue
        if property_name is not None and parts[1] != property_name:
            continue
        limits = parts[0].split('..')
        first, last = int(limits[0], 16), int(limits[-1], 16)
        label = parts[2] if name == 'derived' else parts[1]
        values.append((first, last, labels.get(label, label)))
    values.sort()
    merged = []
    for first, last, label in values:
        if merged and merged[-1][1] + 1 == first and merged[-1][2] == label:
            merged[-1] = (merged[-1][0], last, label)
        else:
            merged.append((first, last, label))
    return merged, hashlib.sha256(path.read_bytes()).hexdigest()
lines = ['// Generated Unicode 17.0.0 tables; see scripts/generate-grapheme-tables.py.',
         '// Unicode data license: https://www.unicode.org/license.txt']
for name, prop, output, enumeration in [('grapheme', None, 'BREAKS', 'Property'),
    ('emoji', 'Extended_Pictographic', 'PICTOGRAPHIC', None),
    ('derived', 'InCB', 'CONJUNCT', 'Conjunct')]:
    values, digest = read(name, prop)
    lines.append('// ' + name + ' source SHA-256: ' + digest)
    typ = '(u32,u32)' if enumeration is None else '(u32,u32,' + enumeration + ')'
    lines.append('pub(super) const ' + output + ': &[' + typ + '] = &[')
    for first, last, label in values:
        tail = '' if enumeration is None else ',' + enumeration + '::' + label
        lines.append(f' (0x{first:x},0x{last:x}{tail}),')
    lines.append('];')
lines.insert(2, 'use super::{Property,Conjunct};')
(root / 'src/grapheme_tables.rs').write_text('\n'.join(lines) + '\n')
