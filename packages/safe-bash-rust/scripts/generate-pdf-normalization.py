"""Generate PDF password NFKC tables: python generate-pdf-normalization.py <ucd-16-directory>."""
from functools import cache
from hashlib import sha256
from pathlib import Path
import sys

ucd = Path(sys.argv[1])
for name, digest in [
    ("UnicodeData.txt", "ff58e5823bd095166564a006e47d111130813dcf8bf234ef79fa51a870edb48f"),
    ("DerivedNormalizationProps.txt", "4d4c03892dea9146d674b686e495df2d55a28d071ac474041d73518f887abddc"),
]:
    if sha256((ucd / name).read_bytes()).hexdigest() != digest:
        sys.exit(f"Expected Unicode 16.0.0 {name}")

excluded = set()
for line in (ucd / "DerivedNormalizationProps.txt").read_text().splitlines():
    fields = [field.strip() for field in line.partition("#")[0].split(";")]
    if fields[1:] == ["Full_Composition_Exclusion"]:
        bounds = [int(s, 16) for s in fields[0].split("..")]
        excluded.update(range(bounds[0], bounds[-1] + 1))

mapping, classes, compositions = {}, [], []
for line in (ucd / "UnicodeData.txt").read_text().splitlines():
    point, _, _, ccc, _, decomposition, *_ = line.split(";")
    c = int(point, 16)
    if int(ccc):
        classes.append((c << 8) + int(ccc))
    if decomposition:
        parts = [int(s, 16) for s in decomposition.split() if not s.startswith("<")]
        mapping[c] = parts
        if len(parts) == 2 and not decomposition.startswith("<") and c not in excluded:
            compositions.append((*parts, c))


@cache
def expand(c):
    return tuple(n for p in mapping[c] for n in expand(p)) if c in mapping else (c,)


pool, offsets, spans = [], [], {}
for c in mapping:
    seq = expand(c)
    if seq not in spans:
        spans[seq] = len(pool)
        pool.extend(seq)
    offsets.append((c, spans[seq], len(seq)))
assert len(pool) < 65536 and max(map(len, spans)) < 128

out = "// Generated from Unicode 16.0.0 by generate-pdf-normalization.py. See LICENSE.UNICODE.\n"
for name, ty, values in [
    ("CLASSES", "u32", classes),
    ("DECOMPOSE", "(u32,u16,u8)", offsets),
    ("SCALARS", "char", [f"'\\u{{{p:x}}}'" for p in pool]),
    ("COMPOSE", "(u32,u32,u32)", sorted(compositions)),
]:
    rows = [str(v).replace(" ", "") for v in values]
    out += f"#[rustfmt::skip]\npub(super) const {name}: &[{ty}] = &[\n"
    for i in range(0, len(rows), 8):
        out += "    " + ",".join(rows[i:i+8]) + ",\n"
    out += "];\n"
(Path(__file__).resolve().parents[1] / "src/commands/pdf_normalization_data.rs").write_text(out)
