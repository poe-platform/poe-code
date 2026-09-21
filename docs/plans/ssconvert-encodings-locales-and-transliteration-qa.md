# Encoding, locale and transliteration QA

Verify the official 1.12.61 archive hash before consulting source in `out`.
Use the separate `ssconvert-statistics-qa` Colima container with the explicit
dependency/plugin profile in `docs/ssconvert/configurable-text-export-profile.json`.
Capture fresh version, dependencies, locales, converter aliases and plugin hashes
under `out/ssconvert-encodings`; native tools are QA oracles only.

Before implementation run in-memory regressions for CP437 output and LATIN10
input. Capture every byte of selected single-byte iconv tables, including invalid
bytes, and verify inverse output mappings. Measure original small CSV fixtures
through native ssconvert for aliases, BOMs, invalid/truncated bytes, escaping,
transliteration, locale category precedence, export locale overrides and TZ.
Compare destination bytes, status, diagnostics and namespace effects separately.

Use deterministic local tables with documented provenance/licensing; do not use
host iconv, ambient environment or locale data in the product. Reject uncaptured
valid converters. Preserve native failed-override fallback for invalid data.
Test command and SDK through their shared engine using memfs, injected byte I/O,
cancellation and byte limits. Run maintained fresh package tests/lint and the
uncached safe-bash workspace build closure and focused integration checks.

After implementation assign a different agent to stress and fix encoding/locale
logic and tests. Root retains exports, integration and Git. Record measured
coverage and outstanding gaps in `docs/ssconvert`; unmeasured cases are gaps.
Inspect manual virtual-command screenshots, then remove owned temporary captures.

## Executed capture and replay details

Reuse the archive in `out/ssconvert-lifecycle` only after rechecking its SHA-256.
Invoke the oracle through the explicit Colima socket, with environment and fresh
HOME/XDG roots from `docs/ssconvert/encoding-reference-profile.json`. Bound regular
text-file reads of gconv declarations before parsing whitespace-separated alias
records. Resolve declared alias chains and separately verify built-in canonical
converter names. Measure all 256 bytes in each admitted codepage and inverse
encodings; include undefined-byte outcomes rather than counting them as successes.

For ASCII transliteration, independently convert and reset iconv for every
non-ASCII Unicode scalar under C and C.UTF-8. For per-target scalar captures,
use a bulk UTF-8 input containing each scalar separated by the printable ASCII
backslash-zero pair; require exactly one delimited output record per scalar and
verify direct encodings against the byte tables. Keep only target differences
from direct byte mapping and the measured ASCII replacements. For UCS-2 astral
captures use NUL separators and decode output UTF-16 units before splitting;
require exactly 1,048,576 records and reject non-BMP replacement units. Delimiters
prevent adjacent source scalars forming a multi-character transliteration rule;
these captures therefore do not measure arbitrary sequence behavior.

The two original Unicode CSV fixtures are embedded with native hexadecimal
expectations in `src/encoding/native-differential.test.ts`. Replay these in memfs
through runCommand and separately exercise SDK/virtual-shell parity. Native
locale startup failures are retained as mismatches, because this implementation
explicitly refuses missing runtime profiles rather than synthesizing GTK warning
timestamps/process IDs and silently continuing in C.

For deterministic TZ auditing invoke `--set 'A1==UNIX2DATE(0)'`,
`--set 'A1==DATE2UNIX(25569)'`, DATE and TEXT formulas, with raw export under UTC,
America/New_York, Europe/Berlin, EST5EDT and empty TZ. The first exploratory
invocation used a single assignment equals and set string values; retain it as
rejected audit evidence until summarizing, never as formula coverage. Corrected
expectations are in the native differential unit cases. NOW/TODAY remain outside
this deterministic native comparison.

Run fresh `npm run test --workspace=@poe-code/ssconvert` and package lint; serialize
the package suite against competing TypeScript builds to avoid CPU contention.
Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash --no-cache`,
the three maintained ssconvert command test files through Node/tsx, safe-bash
test:runner and maintained typecheck, and the guarded root `npm run lint:eslint`.
Record full-route prerequisite failures separately; do not weaken checks.

For manual screenshots use `npx tsx scripts/screenshot.ts --output <owned-out-png>
-- node <temporary-virtual-command-host> '<command>'`. Bind real built product
exports, injected MemoryFileSystem and original Unicode CSV data; inspect ASCII
transliteration under C.UTF-8 with export locale=C and escape-mode output. The
temporary host is only an invocation fixture. This Markdown is the QA procedure.

## Current capability-boundary follow-up

Recheck the archive hash and oracle executable identity. Capture `--version`
from both stdout and stderr (this oracle reports its version on stdout).
Compare dependency versions, installed plugin manifest hashes and available
locales against `encoding-reference-profile.json`.

Force importer `Gnumeric_stf:stf_csvtab` when measuring original encoded bytes;
`Gnumeric_stf:stf_csv` is an exporter, not an importer. Keep exploratory unknown
importer/probe failures excluded from encoding coverage. Measure SHIFT_JIS
`5c7e0a`, `800a`, `82a00a`, BIG5 `a4400a`, GBK `800a`, EUC-JP `a4a20a` and
UTF-8/CP437/unknown-encoding controls. Record exact status, stdout/stderr and
destination bytes. Distinguish unsupported product cases from parity passes.

Run the maintained ssconvert test route with `--no-cache`, package lint,
uncached safe-bash build closure, the three ssconvert command test files and
safe-bash runner/typecheck. Include independent reviewer cases in the final
package gate. Trace prerequisite failures without changing unrelated work.
Run configured ESLint without cache for changed safe-bash test files.

Capture built virtual-command screenshots of BIG5 refusal and ASCII
transliteration. Specify `-T Gnumeric_stf:stf_assistant` for `fd://1` so exporter
guessing does not mask the intended capability check. Inspect both images,
summarize results in `docs/ssconvert/encoding-current-verification.md`, then
remove the owned follow-up output directory and native fixture directory.
