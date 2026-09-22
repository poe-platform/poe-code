# Native byte-string values

`CellValue` distinguishes Unicode text (`kind: "string"`) from native text whose C-string bytes are not valid UTF-8 (`kind: "byte-string"`). The byte-string `value` is nonempty canonical lowercase hex. It contains no NUL byte; native text ends at the first NUL. Valid UTF-8 uses ordinary string values, including a leading BOM. No replacement decoder or guessed legacy encoding supplies a Unicode value.

Snapshots admit only immutable JSON data, reject accessors and host prototypes, validate the payload, and charge its full encoded storage to the existing workbook text budget. Calculation admission separately bounds logical bytes, traversal work and cancellation before allocation. Byte results never borrow caller-owned arrays.

Qualified consumers include LEN, LEFT, MID, RIGHT, ISTEXT/ISNONTEXT, the first-character CODE value, CONCAT/CONCATENATE/TEXTJOIN, bounded byte concatenation and PERL_SED. String array coercion accepts both text representations. Other Unicode renderers and comparisons refuse byte strings explicitly. CODE warnings and wider scalar/operator contexts remain separate qualifications.

UTF-8 STF output follows libgsf1.14.59. Automatic quoting scans GLib characters, so an ASCII byte inside an invalid leading-byte chunk is not an independent quoting trigger. Unquoted fields preserve original bytes. Quoted fields use GLib point conversion, including its historical six-byte encoding of unsigned minus one. Thus selecting the native UTF-8 exporter does not guarantee Unicode-valid output for native invalid-byte inputs. Sinks and Shell callers must retain bytes; use `stdoutBytes` for byte comparisons.

The engine refuses unqualified writers, legacy target encodings, non-ASCII or multiple-character quotes, and unqualified custom formats before opening a destination. Writer capabilities are declarative provider metadata. Normal Gnumeric formula output omits formula caches and writes valid original expressions; replay evaluates them with the optional binding. It does not serialize raw caches. A nonformula opaque value cannot be silently written as hex, blank or invalid XML.

Qualification records: [byte-string proof](byte-string-gap-proof.json), [native byte/cursor evidence](byte-text-cursor-gap-proof.json), and [remaining obligations](gap-resolution.json). Wider byte case conversion, formula/codec contexts, diagnostics and optional profiles remain open.
