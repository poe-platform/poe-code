# Bounded hexdump and hd — issue 684

## Requested behavior and reference

Add default `hexdump` and its canonical-format alias `hd`, with `-C`, `-v`,
`-n LEN` and `-s SKIP`. The issue explicitly makes custom `-e` formats optional;
they remain unsupported rather than accepting an incomplete format language.
Use virtual files and stdin only, with bounded work, memory, output and input,
backpressure, owned bytes and cooperative cancellation. No host fallback.

The pinned comparator is Linux BSD hexdump from bsdmainutils
11.1.2ubuntu3 on little-endian x64, not macOS or an unspecified GNU release.
The applied original utility source and its seven relevant files were read
before implementation and independently reviewed. Default word formatting,
canonical byte columns, repeat suppression, partial blocks, final addresses,
operand handling, skip/count edge cases and errors use exact native receipts.
Unsupported options, fixed byte/endianness profile and resource limits remain
explicit. This is finite qualified compatibility, not universal parity.

## Implementation and ownership

The bounded command family has six source files: command dispatch, formatting,
options, budgets, I/O and public factories. Reuse the shared byte/VFS/invocation
contracts; retain hexdump-specific formatting and parsing instead of changing
the behavior of existing xxd or od. Expose `createHexdumpCommand`,
`createHdCommand`, `createHexdumpCommands`, `hexdumpCommands`,
`HexdumpCommandsOptions` and `HexdumpLimits`.

Nine limits cover arguments, aggregate argument bytes, input, buffered bytes,
output, diagnostics, format count, work and empty input chunks. Reads capture
iterator results once and retain bytes using intrinsic typed-array extents,
not producer-overridden lengths or iterators. Capture destinations and methods
at admission, preserve falsey cancellation identity and drain owned cleanup.

Root assigns the 19 author/independent files and 28 public-integration paths to
one integration owner. Root owns this plan, Git and broad gates. Keep all prior
getopt, raw trim, xargs and mapfile consumer canaries unchanged. No README edits.

## Public integration

Append `hexdump` and `hd` after getopt: 98 default commands, preserving all 96
existing positions. The aggregate forwards only the family's limits and never
consults nested replacement settings. Synchronize current exact inventories
and custom-command counts without rewriting sealed historical evidence.

Add root and scoped command-family exports and one co-bundled portable entry.
All four factories retain root/subpath identity. Typed consumers exercise all
nine limits, options and aggregate configuration. Runtime consumers execute
actual saved VFS scripts, compare exact canonical and alias output files, and
assert the source script and binary input are unchanged.

## TDD and preserved review evidence

- Original author cohort: 222 tests. Subsequent independent checks cover
  iterator result/getter admission, missing-option diagnostics and intrinsic
  byte extents; final author/independent cohort is 258, not their summed total.
- Thirteen intrinsic-extent regressions are preserved red before the v3 fix,
  then green unchanged. A separate replay matches 128 stored native captures;
  it does not claim 128 new native executions.
- Final command handoff: `/tmp/issue684-hexdump-v3-hvpKLE/hexdump-v3.patch`,
  SHA256 `05dff496a373993b56928999f6903af6b752d08db9d4e7306440e33ab4f8401d`.
  Original v1/v2 failures, source hashes and scratch copies remain immutable.
- Five actual public absence failures precede wiring: inventory/factories,
  two saved-file workflows and two aggregate-limit/replacement controls.
  `/tmp/issue684-integration-Oyz8L9/public-red-v1.log` records zero passes and
  five failures, not sandbox file-level reporting.
- Prepared integration patch covers 28 paths. Recheck each baseline before
  admission; preserve the later mapfile discovery line instead of restoring
  an older file snapshot. Scratch parse/hash checks are not integrated gates.

The first maintained focused run passes 263 cases, but root then reproduces
three additional admission defects. A changing args getter is sampled five
times, allowing a second file operand past one-argument/two-byte limits.
Stdout is resampled after its output operation is enrolled, and ownedOutput is
also resampled: a replacement capability whose consumer is already closed can
still receive output. The finite raw receipt remains at the historical path
`out/issue683/hexdump-admission-root-red-v1.json`. These are validated blockers,
not covered by the earlier 263 passing cases or an excuse to weaken contracts.

Repair one authoritative argument snapshot and output-destination enrollment;
add independent snapshot/getter/cancellation controls before changing code.
Preserve the original 258 command and five public assertions, source evidence
and all failures. Audit caller CPU-checkpoint propagation with actual Shell
evidence before making any further change. The integration owner's write scope
includes the new literal snapshot test and its discovery registration. No
broad gate or release is claimed while these defects remain.

The maintained snapshot regression cohort reproduces 25 failures and 13
controls out of 38 cases before repair. It also validates a caller CPU-boundary
failure: after 10,000 skipped bytes and a deterministic five-millisecond Shell
CPU budget, another stdin pull is incorrectly admitted. Preserve
`/tmp/issue684-live-271442/snapshot-red-v2.log` and the earlier evidence.

The narrow repair captures argument and carrier identity once, captures the
caller/output enrollment and destinations, and forwards cooperative yielding
through the original caller signal before rechecking the local output signal.
Keep actual write promises under lifecycle tracking: using an interruptible
output wrapper alone must not prematurely settle an admitted cooperative
write. All four falsey held-write controls remain mandatory. The initial
38-case post-fix run passes, including the CPU next-pull change from one to
zero; final combined and independent qualification remain required.

The combined 301-case run passes, as do 241 discovery/adjacent-byte cases,
633 inventory cases, 19 source-browser cases and focused types. Root's normal
refresh build also passes. These are preserved pre-follow-up results, not
proof of the next candidate: independent review subsequently reproduces four
closed-stderr failures among 15 distinct holdouts.

For every falsey closure reason, an already-closed owned diagnostic sink still
receives an unsupported-option diagnostic. Preserve
`/tmp/issue684-independent-followup-4XHgYY/holdouts-v1.log` (11 pass, four fail).
Admit that unchanged corpus, then fix diagnostic destination enrollment lazily
when diagnostics are actually needed. An unused closed stderr must not abort
successful stdout; close/cancellation must not abort the caller or unrelated
destinations. Preserve awaited cooperative diagnostic writes and falsey reason
identity, plus non-cancellation error-reporting/cleanup information. Add the
corresponding unused-stderr and held-diagnostic controls before the repair.
The earlier source freeze remains preserved; only this narrowly assigned
follow-up, test and discovery paths are reopened before final qualification.

The 52-case diagnostic cohort then passes (19 failures plus 33 controls before
repair), and the combined cohort passes 353 cases. Root subsequently validates
one further lifecycle-admission regression: registered cleanup starts during
stdin EOF, yet a new diagnostic operation reads and writes stderr after close.
`out/issue684/closed-admission-root-red-v1.json` preserves that finite actual
command reproduction. Add the new regression before the narrow I/O repair.
Check closing at new-operation admission, not indiscriminately inside already
admitted diagnostic phases; all sibling-write/drain controls remain mandatory.
Preserve every earlier freeze and passing intermediate run without treating it
as final qualification.

Four appended EOF/read-error close-admission cases reproduce the new failure,
then pass with a single closing check at operation entry. The prior 353 tests
remain unchanged; all 56 lifecycle cases and the combined 357 cases pass, as
do focused types. The final owner freeze is
`/tmp/issue684-close-admission-pDgfTz/owned-freeze-v3.sha256` (49 paths).
Root owns this additional plan path. Independent final review and the complete
committed-candidate gates remain required before delivery.

The first committed candidate is `baac1a1fc5d8c52b82824582f5b4746a573d5904`.
The full test run exposes four missed independent integration inventories:
root bundle entries, root package exports, playground command catalog/count,
and playground help count. The full test and lint runs are interrupted before
editing; they are incomplete, not passing gates. A focused replay records six
failures and 90 passes in `/tmp/issue684-root-inventory-red-v1.log`.

Update those four exact witnesses for the intentional new family and 98-name
inventory, preserving all prior names and assertions. No product behavior or
owned-source tests change. Commit this correction separately, freeze the new
54-path candidate and restart both full gates. Future utility integration must
include these root/playground surfaces as well as the command-package catalogs.

## Validation and delivery

Run focused command/public/discovery/adjacent-byte and browser-source checks,
then refresh the normal workspace build for the new public inventory. Commit
the coherent candidate before the exact committed-archive gate. Run the full
maintained uncached tests and clean lint, then a final normal build, types,
committed archive, package lint and fresh root/scoped packed consumers on Node
and Bun. Browser-platform bundles executed in Node are labeled accordingly.
Retain the mandatory canonical SafeFS facade and inspect terminal screenshots.

Freeze current inputs and artifact inventories before push; preserve all
failures and explicitly distinguish skips, unsupported cases and unavailable
profiles. Push to main, verify remote commit, then close the validated issue.
Monitor actual publication independently while continuing the next issue.
The preceding getopt milestone is delivered at
`95bb5a1bc0839660eb6209a3e5efb8fb9ae119c3`; its ongoing release is not a
hexdump release or a substitute for this candidate's gates.
