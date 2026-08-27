# file: virtual-bash-file-v1 author candidate

This optional, zero-runtime-dependency family classifies VFS bytes. It does not
execute a native utility, consult host files, infer types from filename extensions,
decompress content or claim complete file-format validation. This is a bounded
author candidate awaiting a different verifier; not libmagic parity, root export
approval, default integration or a full repository gate.

## Internal API

`src/commands/file/index.ts` exposes `fileCommands(options?)` (plugin),
`createFileCommands(options?)` (definitions), `createFileCommand(options?)`, and
the types `FileCommandsOptions` / `FileLimits`. Options contain `replace?: boolean`
and `limits?: Partial<FileLimits>`. Factories validate and snapshot limits.
Plugin registration preflights collisions; replacement requires `replace: true`.
Tests manually install this plugin into actual Shell instances.

There is no package subpath or root export yet. The integration owner may add
those only after independent review, then verify a public consumer. No contract
change or new root API is required. A family-local `SharedBudget` is used because
the current CommandContext has no public shared-budget object; parent shell
signals and budgeted sinks remain intact, without resetting the shell budget.

## CLI profile

`file [-bihL] [--mime-type] [--mime-encoding] [--] FILE...`

- `-b` / `--brief`: omit the label; otherwise use `operand: classification`.
  No alignment padding; control/format characters and backslashes in labels and
  symlink targets are escaped. Literal VFS path lookup is unaffected.
- `--mime-type`: MIME only; `--mime-encoding`: charset only; `-i` / `--mime`: both.
  Combining type and encoding flags also selects both, regardless of order.
- `-h` / `--no-dereference`: default, regardless of POSIXLY_CORRECT. Classify the
  symlink entry, without checking its target. `-L` / `--dereference`: follow using
  VFS stat/read behavior. Last -h/-L wins. Loops/dangling links under -L are errors.
  A backend lacking readlink can still identify the entry, without a target label.
- `-` consumes stdin once and labels it `/dev/stdin` (a display label, never a
  host/VFS path lookup). Later `-` operands produce empty. Prefix termination
  closes the upstream iterator; it does not promise to preserve unread pipe data.
  No operands is usage error, not implicit stdin. `--` ends option parsing.
- `--help` and `--version` require no input; the version is virtual-bash-file-v1.
- Ordinary typed VFS errors go to stderr, retain their messages/path meaning,
  continue later operands and yield status 1. Unsupported options/usage yield 2;
  successful classifications yield 0. This differs from native file's default
  stdout-success treatment of some filesystem errors. Non-typed host faults,
  sink failures and cancellation propagate to the shell; no failed sink retry.

Directories and symlinks have inode MIME types; observed empty content uses
inode/x-empty. Permission is determined by the actual read, never fabricated
from advisory modes. Metadata size zero is not a reason to skip opening a file.
No inode/device/identity assumptions, mutation or du-style allocation inference.

## Recognition and limits of meaning

The text profile recognizes strict ASCII, UTF-8, UTF-8 BOM, and UTF-16 LE/BE with
BOM. NUL, disallowed C0/C1 controls, malformed complete encodings, lone surrogates
and invalid UTF-8 are binary. Common textual controls BS/TAB/LF/FF/CR/ESC are
allowed. Prefix endings may contain an incomplete final code unit; decoding is
not finalized unless complete input was observed. UTF-32, legacy codepages and
BOM-less UTF-16 are not supported. Text descriptions intentionally omit native
line-ending counts, BOM wording, language guesses and executable permission claims.

JSON requires a complete bounded object/array that successfully passes JSON.parse
after text decoding. Scalars remain plain text. A syntactically complete JSON
prefix is not proof of a complete document. Streaming input ending exactly at
the sniff cap remains unproved, even if stat.size agrees. Whole readFile content
at the cap can be proved complete. Text classification generally describes only
the sampled prefix, not unseen later bytes.

Header recognition covers PNG, GIF, JPEG, WebP, TIFF, BMP, ICO, PDF, gzip, bzip2,
XZ, Zstandard, ZIP, 7-zip, RAR, POSIX ustar (header checksum), ELF, DOS/PE,
WebAssembly, SQLite3 and OLE compound storage. Minimum header lengths and selected
discriminants are checked; payload/CRC/offset-table integrity is not established.
ZIP does not imply OOXML, JAR or any inner subtype. No extraction or bomb expansion.
Magic-matched formats use binary encoding even for an ASCII-compatible PDF.
Unknown content uses application/octet-stream or the text fallback.

No custom magic files, -z/-Z, --extension/--apple, -f input lists, -e test exclusions,
recursive traversal, filesystem devices, permissions inspection, access-time
restoration, alternate formatting, libmagic parameter flags, CSV/XML/HTML/script
language classification, Mach-O or arbitrary libmagic database compatibility.
Unknown options fail explicitly; unsupported format bytes take the fallback.

## Bounded I/O and budgets

Defaults (all positive safe integers; maxDurationMs <= 2147483647):

| Limit | Default | Meaning |
| --- | ---: | --- |
| maxSniffBytes | 65536 | retained sample per operand |
| maxReadFileBytes | 1048576 | maximum authorized whole-read fallback |
| maxInputBytes | 8388608 | aggregate ByteIO and admitted metadata UTF-8 bytes |
| maxOutputBytes | 1048576 | combined stdout and stderr bytes |
| maxChunkBytes | 1048576 | maximum delivered input chunk/output chunk |
| maxEntries | 1024 | operand count, preflighted |
| maxSteps | 1048576 | iterations, sampled bytes, operands and text work units |
| maxArgumentBytes | 65536 | UTF-8 arguments plus one separator each |
| maxDurationMs | 10000 | active invocation deadline |

Streaming requests start=0/endExclusive=maxSniffBytes and a bounded chunkSize,
with the combined signal. Every delivered byte is charged, including oversized
producer chunks, rather than pretending excess bytes were never delivered.
Retained chunks are copied, writes awaited, iterator return awaited on early
termination, and a per-file signal aborted at the prefix cap or after EOF. The
exact intentional per-file abort reason is accepted during return cleanup;
other cleanup failures propagate. Late read/return
errors before the boundary are failures; later unread content is not validated.
Host producers may allocate more than requested; chunk/input checks detect that
after delivery. Retained memory is bounded, not arbitrary producer allocation.

Without readStream, readFile is allowed only when size is a safe nonnegative
integer within min(maxReadFileBytes, maxChunkBytes, remaining input budget).
Unknown size is explicitly unsupported. maxBytes and the signal are passed;
returned length is rechecked, but **a whole-file fallback has already allocated
storage in the backend**. Stat checks are not leases or allocation guarantees;
concurrent growth or an adapter ignoring maxBytes cannot be undone. A large file
on a readFile-only backend is rejected even if a prefix would suffice.

Steps periodically yield so empty streams cannot starve timers. Timeouts and
external cancellation propagate (including errno-shaped reasons); uncooperative
host work can outlive cancellation and completed effects cannot be undone, but
late promise rejections are observed. Diagnostic output obeys the combined byte
budget and can be truncated or absent if the budget is exhausted. Parent shell
limits still apply separately; family limits are not one shared shell quota.

### TEXT-BOUND-001: metadata and diagnostic admission

The text-safety correction extends these existing family limits; it does not add
flags or filesystem contracts. Raw readlink targets and backend error messages
first undergo constant-time UTF-16 length checks against remaining input/work
budgets, and against remaining output for text that will be rendered. Only then
are codepoints examined. Actual UTF-8 metadata bytes are charged cumulatively
with ByteIO bytes; labels/arguments use the separate argument quota and shared
work quota. Argument count and string length are checked before UTF-8 scans.

Escaping admits each generated piece against remaining output before retaining
it, works on one Unicode codepoint per regex call, and yields/checks cancellation
after at most4096 UTF-16 units. Metadata and label work is charged before the
loop; output text length/work and exact UTF-8 bytes are admitted before encoding.
Each field is bounded by remaining output; the final line (at most two such
fields plus fixed formatting) is checked again before any full-line encoding.
Admission is cumulative across operands/errors, not a fresh per-entry allowance.
MIME-only symlink handling still calls readlink and preserves its errors, and
admits/charges its target, but does not escape/build an unused human description.

Normal usage and filesystem diagnostics preserve their existing complete text
when admitted. A quota error uses a known short diagnostic instead of trying to
escape the rejected backend text again. To report exhausted work safely, the
family has a fixed, cumulative **64 UTF-16-unit emergency diagnostic reserve**
separate from maxSteps. It still obeys the shared maxOutputBytes, maxChunkBytes,
signal and deadline. Its input is sliced before encoding, UTF-8 accounting
precedes encoding, and truncation preserves whole Unicode codepoints. This
bounded reserve is not a reset of the ordinary work budget. The command uses
it only for terminal limit messages; long admitted usage errors are not silently
reduced to64 units. No ordinary scan is exempted from work/input admission.

This closes command-owned preprocessing on unrestricted metadata/error strings,
not a catastrophic-regex issue or a host-JavaScript sandbox guarantee. Backend
string construction/allocation, getters, whole readFile allocation, and arbitrary
host execution still precede or lie outside command admission. The configured
limits authorize bounded work, not a hard heap ceiling or preemption within a
single JavaScript primitive. No decompression or native libmagic is involved.

## Evidence

Run `node --import tsx --test tests/commands/file/*.test.ts`.
The frozen native corpus and provenance are in `tests/commands/file/`.
Original candidate d168d18b118592e04a6eec9b00eb50cc2b1e5058 on the recorded Darwin
file-5.41 profile: plain MIME 23/26 exact; combined MIME and encoding 22/26 exact;
human category wording 26/26 semantic, not exact text. Its MIME differences were
PE, WebAssembly and SQLite; PDF encoding also differed. These original results
and the original source hashes remain recorded in the author/native evidence.

The August 27, 2026 SQLITE-MIME-001 correction uses the registered
application/vnd.sqlite3 instead of the deprecated application/x-sqlite3 alias.
The IANA registration dated February 12, 2018 reserves the alias for required
backwards compatibility; no such need exists for this new optional candidate.
Primary source: https://www.iana.org/assignments/media-types/application/vnd.sqlite3
This is a narrow v1 candidate correction, not expanded format validation.
On the unchanged 26 author byte fixtures/native capture, corrected plain MIME
is 24/26 exact and combined MIME/encoding is 23/26 exact; human categories remain
26/26 semantic. PE/WebAssembly MIME and the PDF binary-encoding profile remain
unchanged. Independent original F16 and the other holdout results are untouched;
their corrected-harness replay remains a separate verifier gate.
Do not turn these mismatches into parity passes. There is no measured performance,
real-provider interoperability or just-bash superiority claim in this candidate.
