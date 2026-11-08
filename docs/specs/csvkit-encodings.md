# csvkit 2.2.0 encoding boundary

The reference is CPython 3.14.2, csvkit 2.2.0, Agate 1.14.2 and
SQLAlchemy 2.0.54 with the existing C/UTC profile. Captures are byte-exact
hexadecimal records in docs/csvkit/encoding-reference.json and
codec-primitives-reference.json. This specification describes the qualified
finite subset, rather than all CPython codecs or all stream configurations.

## Input

CSV input defaults to utf-8-sig unless the supplied exported environment contains
PYTHONIOENCODING. Explicit -e/--encoding overrides that value. The complete
environment value is the input codec name: utf-8:replace and utf-8:ignore fail
with LookupError, while trailing punctuation in utf-8: normalizes to utf_8.
An empty exported value is an unknown encoding. Shell-local unexported variables
do not enter this environment. Codec aliases normalize with the frozen standard
registry; unknown codecs report LookupError, and known codecs lacking an injected
implementation remain status-78 capability blockers.

pythonCodecs is an explicitly injected finite set covering UTF-8/sig, UTF-16
with mandatory TextIO signature, explicit UTF-16 little/big endian, ASCII,
ISO-8859-1 and CP1252. It does not load codec plugins, iconv or Python.
CP1252's five undefined bytes are strict decode errors. Latin-1 preserves all
byte values, including C1 controls, rather than applying a Windows codepage.
UTF-16 rejects invalid surrogate sequences and odd final bytes. Explicit endian
codecs preserve a decoded BOM; utf-16 consumes its initial endian signature.
The bulk bytes.decode API for utf-16 is distinct: without a BOM it defaults to
the frozen profile's little endian. This is not TextIO behavior.

Streaming decoders use bounded 8,192-byte decode windows independent of producer
fragmentation. An invalid byte inside a window rejects that window before it
produces CSV output; a truncated final sequence can preserve previously decoded
rows and then fail at decoder finalization. The incremental utf-8-sig decoder
retains and drops a possible incomplete BOM prefix at EOF, unlike strict bulk
bytes.decode. Named and borrowed input retain the existing separate newline/NUL
and ownership rules. Producer failures preserve already admitted partial input;
cooperative producer cleanup is still awaited and its primary-failure precedence
is preserved.

sql2csv has its own UTF-8 query-input default, independent of this common input
default. --encoding-xls belongs to the XLS workbook reader and does not replace
the text input codec. Workbook reading itself remains an implementation blocker.

## Output and explicit divergences

-e does not select the Python source output stream's encoding. The current
JavaScript engine writes UTF-8 stdout/stderr; therefore parity is qualified only
against the frozen UTF-8 output profile. PYTHONIOENCODING-selected Python stdout
in Latin-1, CP1252, UTF-16 or utf-8-sig is a measured divergence, including help,
non-CSV modes and stderr. Five corresponding captured cases remain test TODOs,
never parity passes. Output encoding failures, stderr backslash replacement,
native buffering/signals and arbitrary stream reconfiguration remain blockers.

Inherited --add-bom emits the raw UTF-8 signature at the common parsed-run
boundary before command input acquisition, including names, counts and JSON.
Errors after that boundary retain the signature. Help exits before that boundary;
sql2csv suppresses the option. The current UTF-8 host stream emits one signature
and does not add another through the input codec. In the *native* utf-8-sig stdout
profile, --add-bom plus the stream encoder produces two signatures; that captured
profile is an explicit divergence, not silently normalized into a parity pass.

The codec encode API is separate from the output stream: successful strict
str.encode observations are tested for the finite codec set. Strict encode
failure detail and verbose Python traceback identity remain unqualified; no
unpaired surrogate may be silently replaced and credited as Python parity.
