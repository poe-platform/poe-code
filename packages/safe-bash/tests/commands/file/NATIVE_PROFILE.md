# Author oracle profile (not an independent gate)

The initial capture used `/usr/bin/file -bi`. On this Darwin file-5.41,
`-i` requests filesystem-only classification, so all 26 deterministic regular
file fixtures returned the literal `regular file` for that column. None was a
MIME pass. The human column used `-b` and was unaffected. This original oracle
defect is retained here rather than silently treating the initial 0/26 as MIME
evidence. The corrected capture uses the unambiguous long option `--mime`.
The virtual command deliberately supports `-i` as the MIME alias, independent
of that Darwin short-option variant.

The reproducible driver is `node --import tsx tests/commands/file/native.ts`.
It only classifies its own deterministic bytes in an owned temporary directory,
removes that directory, and uses explicit `/usr/bin/file`, an isolated HOME,
LC_ALL=C, and `-m /usr/share/file/magic.mgc`. It does not classify arbitrary host
files. Reads of the executable/database are solely provenance SHA256 hashing.
No oracle dependency is installed or downloaded.

Observed author host: Darwin arm64, Node v22.22.2, file-5.41.
Executable SHA256: d1fee5edf3c39243cca0c4a0afc94816c55feb032ad5eaeb6d8170d8c7aa64ce.
Magic SHA256: 38fc8af9d342a3a1d32a626195314a913ee255d8cbd259067d665ea55735b7c0.
The native version reports magic sources at `/usr/share/file/magic`.
This is not a GNU/Linux profile, latest-file claim, or complete format validator.

Primary upstream references inspected using the web tool, pinned to FILE5_41:

- https://github.com/file/file/blob/FILE5_41/doc/file.man
- https://github.com/file/file/blob/FILE5_41/magic/Magdir/images
- https://github.com/file/file/blob/FILE5_41/magic/Magdir/compress
- https://github.com/file/file/blob/FILE5_41/magic/Magdir/database

The fixture cohort contains intentionally synthetic header-only image,
executable, database and archive samples. Signature recognition does not claim
that these samples can be decoded, launched, opened as databases or extracted.
The gzip fixture was produced by Node zlib and then frozen to identical hex
(same SHA256), but native file describes it as
`gzip compressed data, truncated`; retain that wording, not a validity verdict.

## Original d168 comparison, same 26 byte inputs

Frozen rows, SHA256 and native human wording: `native-baseline.ts`.
For d168d18b118592e04a6eec9b00eb50cc2b1e5058, plain MIME type comparison was
**23/26 exact**; combined MIME+encoding was **22/26
exact**. Human category comparison is **26/26 semantic**, not exact wording or
payload validity. These scopes are deliberately separate. The comparison test
passes by asserting both matches and the following known mismatches; that does
not make the mismatches parity passes.

| Fixture | Native MIME | Candidate MIME |
| --- | --- | --- |
| pe-header | application/x-dosexec | application/vnd.microsoft.portable-executable |
| wasm-empty | application/octet-stream | application/wasm |
| sqlite-header | application/vnd.sqlite3 | application/x-sqlite3 |

PDF has the same MIME type but native charset=iso-8859-1 vs candidate
charset=binary. The candidate uses binary for recognized nontext format headers.
The PE semantic category allows either ordering of PE/executable; the exact
native `Unknown PE signature 0` wording remains frozen, not hidden as a validator
success. The original 26 fixtures and their hashes were not replaced to increase
these denominators or turn known profile differences into exact matches.

The first author test run was 31/32 due solely to a Buffer-vs-Uint8Array
deepStrictEqual prototype mismatch on otherwise identical PNG bytes. The test
now compares Uint8Array to Uint8Array, preserving exact bytes; the next 32/32 run
then exercised the rest of that Shell pipeline test. Later author stress checks
found and fixed Buffer.slice ownership, prefix signal/return ordering and
diagnostic deadline handling before freezing the candidate. No independent
holdout tests were read or modified.

## SQLITE-MIME-001 correction, August 27, 2026

Root authorized only the SQLite canonical MIME correction after routing the
independent initial frozen F16 observation. Original F16 and all independent
holdout fixtures/results remain unchanged and were not opened by this author.
Only the routed failure summary and its SQLite primary registration document
were read. The three signal-object-identity harness defects are not source-fix
requests; no signal, timeout, read/return error or cancellation semantics changed.
The independent late-error probes remain unrun until the verifier corrects its
harness and replays the new snapshot.

Independently verified official registration:
https://www.iana.org/assignments/media-types/application/vnd.sqlite3
(registered/updated February 12, 2018). It specifies application/vnd.sqlite3,
binary encoding, and reserves deprecated application/x-sqlite3 for required
backwards compatibility. This new optional candidate has no such requirement.

Only the SQLite MIME literal and its author fixture expectation change;
the existing 512-byte SQLite specimen remains SHA256
20687ffcc0619f5c53e81e13b058fec6eec09d9958b6531892672be98b3625d6.
All 26 input hashes and the entire native-baseline.ts capture remain unchanged.
The corrected author comparison is **24/26 plain MIME exact**, **23/26 combined
MIME/encoding exact**, and **26/26 human category semantic**. Remaining MIME
differences are PE and WebAssembly; PDF retains binary encoding. The original
23/26 and 22/26 observations above are historical, not rewritten as corrected
passes. No native cohort expansion or independent replay is included here.

The actual-Shell regression tests exercise --mime-type and --mime for both a
misleading-extension VFS file and redirected binary stdin. Both tests failed
on the original source with exactly the deprecated output before the fix.

Original d168 source/fixture SHA256 retained for this correction:

| Path | SHA256 |
| --- | --- |
| src/commands/file/classify.ts | d3f17f0e1d5ffeff08a015ee7131d9934a3938148ab65388478702e2764f0d1e |
| src/commands/file/index.ts | 1753ac81d099b329d52bb83b0047d5241ca25ec74f9c57b62399f254404ee825 |
| src/commands/file/shared.ts | fa4d86f5cc1eb3a642aac34845737566c89e2b2b4983ec21a111441c3b94f87a |
| tests/commands/file/fixtures.ts | adfdad35054df359e51e6755b44cde4f89aaf4178e1d8de6f7001f2678f4d70f |
| tests/commands/file/native-baseline.ts | 73df75acdfa3a030889505dc702d40d9039a475fefdf7e1b6794af88218bec73 |

The immutable d168 commit and original /tmp/safe-bash-file-author-detail.txt
retain the complete original 12-path hashes and author validation history.
