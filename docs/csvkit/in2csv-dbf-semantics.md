# Released in2csv DBF reference semantics

Reference: csvkit 2.2.0 source SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`, frozen CPython 3.14.2 profile and hash-required `requirements-cpython-3.14.2.txt`. Native subprocess use is reference tooling only. Exact captured observations, base64 file inputs and unchanged-file effects are in `in2csv-dbf-reference.json`.

## Entry and typing

`csvkit/utilities/in2csv.py` opens the input as a text handle, but DBF conversion passes only `input_file.name` to `agate.Table.from_dbf`; it does not read the text bytes. The conversion must reopen the named binary source. Source rejects handles without a name; native piped CLI stdin has the name `<stdin>` and instead fails with `DBFNotFound: could not find file '<stdin>'`. There is no DBF stdin conversion support.

`agatedbf/table.py` calls `DBF(path, load=True, encoding=None, recfactory=recfactory)`, then `agate.Table(dbf.records, column_names=dbf.field_names)` without supplied column types. Types therefore use ordinary default Agate inference over parsed values, rather than fixed types derived from descriptor kinds. Character `1` becomes `True`; numeric `1` alongside null also becomes `True`. Character `001` and `2` together become numbers `1` and `2`. Dates and timestamps serialize using Agate date and datetime types.

The DBF branch ignores `--no-inference`, `--no-header-row`, `--skip-lines`, `--snifflimit`, locale, date and datetime inference format options. CLI `--encoding` affects opening the unused text input handle but is not forwarded to the DBF decoder. The decoder uses the header language-driver mapping, with unknown drivers falling back to ASCII. Unicode errors are caught by csvkit and misleadingly describe the CLI selected encoding; setting `--encoding` does not resolve DBF bytes that fail the header-selected codec.

## Headers and records

`dbfread/dbf.py` unpacks the 32-byte little-endian header and descriptors; descriptors end on CR, LF or EOF. Descriptor names stop at NUL and decode strictly with the chosen codepage. C-field length combines the one-byte length and precision byte as a 16-bit value. Other descriptors preserve the one-byte length and precision. Only I length 4 and L length 1 are checked eagerly; unknown kinds fail eagerly. The version byte is otherwise not validated. Header date errors are ignored. Header record count is ignored.

Record iteration seeks to the header length, follows physical record order and stops on byte 0x1a or EOF. Active separator space parses fields consecutively by descriptor lengths; deleted separator `*` is skipped in the active pass. Other separators skip `recordlen - 1` bytes. `load=True` runs a second full pass parsing deleted records, so a malformed deleted value still prevents any CSV output. All active errors occur before deleted errors regardless of physical placement. A short character field is accepted at EOF; a short binary integer raises the native struct error. Declared record length does not realign successfully parsed active rows.

## Field values

`dbfread/field_parser.py`: C/V remove trailing NULs/spaces only; D creates a date from YYYYMMDD or null if bytes contain only spaces/zeros; L accepts TtYy, FfNn and null `?`/space. N strips whitespace then outer asterisks, tries integer then float with comma replaced by dot; F uses float without comma replacement. I/+ are signed little-endian int32. O is native-profile little-endian double. Y is signed int64 divided by 10000 as Decimal. T/@ contain unsigned little-endian Julian day and milliseconds; day zero is null. Kind 0 returns raw bytes, subsequently cast to Python bytes representation by Agate. Other malformed values raise the exact messages captured in JSON.

## Memo companions

Any M/G/P/B field requires a companion even with zero memo indices or FoxPro B double fields. Case-insensitive sibling lookup prefers FPT over DBT. FPT always uses a 512-byte big-endian file header, its block-size field, and big-endian memo type/length headers. Type 1 is decoded text; type 0/2 and unknown types are binary. Truncated memo payload raises `OSError: EOF reached while reading memo`. DBT uses DB3 only when DBF version equals 0x83; all other DBT versions use DB4. Both use fixed 512-byte blocks. DB3 reads to first 0x1a or EOF. DB4 reads an eight-byte little-endian memo header and advertised body, truncates at 0x1f and accepts a short body. M decodes text unless FPT marks it binary; G/P and non-FoxPro B return raw bytes. FoxPro versions 0x30/31/32 interpret B as double, while still requiring the companion because of header-level detection.

## Explicit limits

Native malformed backward/overlapping skip lengths were not executed because they can cause unbounded iteration. Unsampled driver encodings, compressed filename behavior, interactive behavior, cancellation and stream backpressure remain unmeasured by this reference corpus. These observations establish native behavior only; they do not establish JavaScript product compatibility.
