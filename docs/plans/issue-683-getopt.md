# Bounded enhanced getopt

Implement #683's missing util-linux long-option command, not the separate
existing getopts builtin or its historical performance issue. Preserve the
actual `getopt -o SHORT --long LONG -- "$@"` workflow and shell-safe re-emission.
Read the full reference utility and parser before implementation.

## Reference and design

The pinned utility is util-linux 2.34-0.1ubuntu9.6; its complete 472-line
getopt.c SHA256 is
`edb410cebd71d1a2584d967a3691db5020010a6d8648a41e5e513f3b83f6bb92`.
Read the matching glibc 2.31 parser and internal header (810 and 159 lines).
Preserve the original 40 native receipts in
`/tmp/issue683-getopt-oracles-mRPoFt/results.json` and subsequent independent
edge captures, including signed-byte EOF/permutation cases.

Use one bounded byte-oriented parser for wrapper and target arguments, with a
stable operand queue rather than quadratic argv swapping. Keep original and
parser-adjusted short specifications distinct where native emission semantics
require them. Handle required/optional short and long arguments, exact/unique
prefix matching, duplicate long definitions, termination, permutation,
compatibility/POSIX environment modes and Bash/tcsh quoting. Preserve raw bytes,
diagnostics and return statuses; document Linux-reference qualifications and
explicitly virtual information banners rather than claiming universal parity.

Bound arguments, per-argument and aggregate input bytes, option schema, long
definitions, retained memory, stdout, stderr and work. Resource failures use
explicit status 3, not a guessed native parse success. Yield cooperatively and
preserve falsey cancellation, single method acquisition, receiver identity and
registered cleanup/owned-output drain. The command does not read stdin or VFS
files and has no host process, network or LLM fallback.

## Ownership and public integration

The author owns only `src/commands/getopt`, its author tests and `docs/GETOPT.md`
within safe-bash. Independent tests have a separate directory. Root owns public
exports/composition/tests and this plan; the inventory owner updates existing
current inventories and consumers without changing sealed historical evidence.
No README additions.

Expose `createGetoptCommand`, `createGetoptCommands`, `getoptCommands`,
`GetoptCommandsOptions` and `GetoptLimits`. Append getopt after factor for 96
default commands. Aggregate configuration forwards limits only, never a nested
replacement option. Root/scoped Node and co-bundled browser/workerd subpaths
retain factory identity.

## Validation and delivery

Record missing public behavior before wiring. Compare native stdout, stderr and
status exactly in the admitted profile; test an actual saved VFS script using
command substitution, eval and set to recover empty/apostrophe-bearing values.
Keep native capture argv0 explicit: an absolute invocation prints its absolute
path in errors, unlike normal shell lookup. Root's three original absolute-path
captures remain in `out/issue683/native-public-v1.json`; matching argv0 captures
are separately retained as `native-public-v2.json`. The initial sandbox EPERM
before any native execution is not a behavioral result.

Register literal tests; run author/independent/source/mock checks and inspect
terminal output visually. Run full tests/lint, final normal build, types, exact
committed archive, package lint and fresh packed consumers before pushing.
Preserve failures, freeze current inputs and distinguish skipped/unavailable
profiles from passes. Commit atomically, verify remote main before closing #683,
and monitor actual publication while continuing to #684.

Four actual public absence regressions are preserved in
`/tmp/issue683-public-red-v1.log`: missing registration/factories, the saved
eval/set round trip, partial target-error normalization and the enhanced-mode
probe. Integration also checks aggregate argument limits and a nested replacement
getter that must not run. The author's maintained source suite passes 137 cases
before independent code-review completion; its evidence is
`/tmp/issue683-getopt-maintained-v1.log`, not a final broad/packed gate claim.

All five public integration tests pass in
`/tmp/issue683-public-integrated-v1.log`. The saved-script round trip preserves
apostrophes and both optional and positional empty arguments; target errors
retain normalized stdout with status 1, and -T returns 4. The actual transcript
and visually inspected terminal image are retained in
`out/issue683/terminal-v1.txt` and `out/issue683/terminal-v1.png`.

Independent review freezes 154 cases: 152 pass and two valid-UTF-8 saved-script
cases expose a separate core eval byte-loss defect. Before eval, getopt preserves
the raw bytes; eval without getopt reproduces the loss. Preserve both failures
and fix the shared expansion path before the integrated gate. The exact log is
`/tmp/issue683-getopt-independent-v4.log`; native controls are retained in
`/home/kjopek/project/poe-code-unit-55fyhF/issue683-getopt-eval-native-a79s6zcj/results.json`.
The separate saved command-substitution/suffix-trim recipe also exposes core
byte loss and remains a required consumer check, not an avoided fixture.
Earlier fixture mistakes and the existing explicit non-UTF-8 source refusal
are recorded separately; they are not getopt parser defects or passing native
compatibility cases. Current source, consumers and archive/packed gates remain
pending these fixes.

The raw expansion repair is committed separately as `e9431bd55`. Root's focused
precommit replay passes 98/98 cases; the owner also records 191/191 focused,
477/477 adjacent and 48/48 source/mock cases. These overlap and are not summed.
An expanded independent forwarding corpus subsequently isolates one remaining
raw-input decoding failure in xargs, outside getopt and the repaired interpreter.
Keep that failing native fixture and repair xargs separately before the broad
integrated gate. No current remote delivery or publication is claimed here.

The separate xargs repair now passes 231/231 focused/adjacent cases and the
unchanged 215/215 expanded independent corpus, including the original raw
forwarding failure. Its plan records the exact remaining trace-format profile;
the native ineffective-option warning is fixed byte-for-byte. Root getopt
precommit validation passes 296/296 author, independent and public cases in
`/tmp/issue683-getopt-root-precommit-v1.log`. The fresh packed consumer must also
execute the added raw xargs-to-saved-script/getopt/eval round trip. Its initial
failure remains in `/tmp/issue683-xargs-consumer-red-v1.log` and the independent
green replay in `/tmp/issue683-xargs-consumer-independent-green-v1.log`.
