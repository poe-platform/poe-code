"""Generate Calc's en-US collation tables using LibreOffice 24.8's ICU 74.2.

LD_LIBRARY_PATH=<LibreOffice program directory> python generate-office-collation.py
The output needs no ICU library at runtime. See LICENSE.UNICODE.
"""

import ctypes as c
from pathlib import Path

lib = c.CDLL("libicui18n.so.74")
uc = c.CDLL("libicuuc.so.74")


def api(lib, name, args, result):
    f = getattr(lib, name + "_74")
    f.argtypes = args
    f.restype = result
    return f


ptr = c.c_void_p
integer = c.c_int
error = c.POINTER(integer)
open_coll = api(lib, "ucol_open", [c.c_char_p, error], ptr)
strength = api(lib, "ucol_setStrength", [ptr, integer], None)
open_elements = api(lib, "ucol_openElements", [ptr, ptr, integer, error], ptr)
set_text = api(lib, "ucol_setText", [ptr, ptr, integer, error], None)
next_element = api(lib, "ucol_next", [ptr, error], integer)
get_sets = api(
    lib, "ucol_getContractionsAndExpansions", [ptr, ptr, ptr, c.c_bool, error], None
)
open_set = api(uc, "uset_openEmpty", [], ptr)
count_set = api(uc, "uset_getItemCount", [ptr], integer)
get_item = api(
    uc, "uset_getItem", [ptr, integer, error, error, ptr, integer, error], integer
)
version = api(lib, "ucol_getVersion", [ptr, ptr], None)
ucaversion = api(lib, "ucol_getUCAVersion", [ptr, ptr], None)
status = integer()
coll = open_coll(b"en_US", c.byref(status))
strength(coll, 1)
elements = open_elements(coll, b"", 0, c.byref(status))


def ces(text):
    raw = text.encode("utf-16-le")
    status.value = 0
    set_text(elements, raw, len(raw) // 2, c.byref(status))
    result = []
    while True:
        n = next_element(elements, c.byref(status))
        if n == -1:
            break
        n = n & 0xFFFFFFFF
        if n:
            result.append(n)
    assert status.value == 0, status.value
    return tuple(result)


def contraction_strings(prefixes=False):
    s = open_set()
    status.value = 0
    get_sets(coll, s, None, prefixes, c.byref(status))
    assert status.value == 0
    values = []
    buf = c.create_string_buffer(4096)
    for i in range(count_set(s)):
        start = integer()
        end = integer()
        status.value = 0
        n = get_item(
            s, i, c.byref(start), c.byref(end), buf, len(buf) // 2, c.byref(status)
        )
        assert status.value == 0, status.value
        if n:
            values.append(buf.raw[: n * 2].decode("utf-16-le"))
    return values


for function, expected in [(version, [153, 121, 0, 0]), (ucaversion, [15, 1, 0, 0])]:
    value = (c.c_ubyte * 4)()
    function(coll, value)
    if list(value) != expected:
        raise SystemExit(
            f"Expected LibreOffice 24.8 ICU collation version {expected}, got {list(value)}"
        )
pool = []
stored = {}
spans = []
classes = []
get_class = api(uc, "u_getCombiningClass", [c.c_int], c.c_ubyte)
nfd = api(uc, "unorm2_getNFDInstance", [error], ptr)(c.byref(status))
decompose = api(
    uc, "unorm2_getDecomposition", [ptr, integer, ptr, integer, error], integer
)
decomposed = c.create_string_buffer(128)


def save(start, end, key, step):
    if key not in stored:
        stored[key] = len(pool)
        pool.extend(key)
    spans.append((start, end, stored[key], len(key), step or 0))


def implicit(point):
    point += 1
    low = 2 + (point % 18) * 14
    point //= 18
    third = 2 + point % 254
    point //= 254
    second = 4 + point % 251
    return (((0xFE00 + second) * 256 + 5) * 256 + 5, (third * 256 + low) * 65536 + 192)


start = previous = None
first = last = None
step = None
for point in range(0x110000):
    if 0xD800 <= point <= 0xDFFF:
        continue
    char = chr(point)
    key = ces(char)
    status.value = 0
    n = decompose(nfd, point, decomposed, 64, c.byref(status))
    assert status.value == 0
    text = decomposed.raw[: n * 2].decode("utf-16-le") if n >= 0 else char
    leading = get_class(ord(text[0]))
    trailing = get_class(ord(text[-1]))
    if leading:
        classes.append((point, (leading << 8) | trailing))
    if key == implicit(point):
        continue
    delta = key[-1] - last[-1] if key and last else 0
    if (
        start is not None
        and point == previous + 1
        and len(key) == len(last)
        and key[:-1] == last[:-1]
        and (step is None or delta == step)
    ):
        if step is None:
            step = delta
    else:
        if start is not None:
            save(start, previous, first, step)
        start = point
        first = key
        step = None
    previous = point
    last = key
save(start, previous, first, step)
contractions = []
normal = set(contraction_strings())
for value in sorted(normal):
    key = ces(value)
    if key not in stored:
        stored[key] = len(pool)
        pool.extend(key)
    contractions.append((value, stored[key], len(key)))
prefixes = []
for value in sorted(set(contraction_strings(True)) - normal):
    assert len(value) == 2
    before = ces(value[0])
    key = ces(value)
    assert key[: len(before)] == before
    key = key[len(before) :]
    if key not in stored:
        stored[key] = len(pool)
        pool.extend(key)
    prefixes.append((ord(value[0]), ord(value[1]), stored[key], len(key)))

upper = api(
    uc, "u_strToUpper", [ptr, integer, ptr, integer, c.c_char_p, error], integer
)
buf = c.create_string_buffer(64)
upper_keys = []
for point in range(0x110000):
    if 0xD800 <= point <= 0xDFFF:
        continue
    text = chr(point)
    raw = text.encode("utf-16-le")
    status.value = 0
    n = upper(buf, 32, raw, len(raw) // 2, b"en_US", c.byref(status))
    assert status.value == 0
    result = buf.raw[: n * 2].decode("utf-16-le")
    # LibreOffice's uppercase mapping uses the capital sharp S, independently
    # checked along with all 1,525 mappings through native UPPER formulas.
    if point == 0xDF:
        result = "ẞ"
    if result != text:
        upper_keys.append((point, result))


def string(text):
    return '"' + "".join(f"\\u{{{ord(char):x}}}" for char in text) + '"'


output = "// Generated by generate-office-collation.py from LibreOffice 24.8 ICU 74.2.\n// en-US, full collation elements, normalization off; UCA 15.1. See LICENSE.UNICODE.\n"
for name, typ, values in [
    ("SPANS", "(u32,u32,u32,u8,i64)", [str(value).replace(" ", "") for value in spans]),
    ("ELEMENTS", "u32", list(map(str, pool))),
    (
        "CONTRACTIONS",
        "(&str,u32,u8)",
        [
            f"({string(text)},{offset},{length})"
            for text, offset, length in contractions
        ],
    ),
    (
        "PREFIXES",
        "(u32,u32,u32,u8)",
        [str(value).replace(" ", "") for value in prefixes],
    ),
    ("CLASSES", "(u32,u16)", [str(value).replace(" ", "") for value in classes]),
    (
        "UPPER",
        "(u32,&str)",
        [f"({point},{string(text)})" for point, text in upper_keys],
    ),
]:
    output += f"#[rustfmt::skip]\npub(super) const {name}: &[{typ}] = &[\n"
    for i in range(0, len(values), 4):
        output += "    " + ",".join(values[i : i + 4]) + ",\n"
    output += "];\n"
(
    Path(__file__).resolve().parents[1] / "src/commands/office_collation_data.rs"
).write_text(output)
print(
    len(spans),
    "spans,",
    len(pool),
    "elements,",
    len(contractions),
    "contractions,",
    len(upper_keys),
    "uppercase mappings",
)
