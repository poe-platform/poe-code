# Phase 1: private getopts scanner

Root approved **only** new `src/shell/getopts.ts` and this test tree. Runtime,
shell state, variable binding, builtin registration, public exports and shared
output integration are excluded. O060 is deferred. This is **not usable shell
getopts** and does not establish native or product parity.

## Frozen private API/profile

The following API/profile is frozen before the helper candidate:

- `createGetoptsState(): GetoptsState` starts with internal `index: 0`.
- `cloneGetoptsState(state): GetoptsState` validates and copies the active cursor.
- `withGetoptsIndex(state, index): GetoptsState` accepts safe integer numbers;
  values <=1 clear the cursor/reset to index0, larger values retain its independent
  `{ argument, offset }` cursor. It does not implement variable assignment,
  arithmetic coercion, signed32 conversion, local binding or runtime reset hooks.
- `scanGetopts(state, optstring, args, options): Promise<GetoptsScanResult>` scans
  one option from an explicitly supplied immutable string array. Options contain
  `reportErrors: boolean` and mandatory `work: GetoptsWork`.
- Work has explicit nonnegative safe-integer `maxArguments`, `maxBytes`,
  `maxSteps`, positive safe-integer `yieldEvery`, optional `signal`, and mandatory
  `checkpoint(steps): void | Promise<void>`. Each checkpoint receives newly
  charged work since the last checkpoint. Host adapters must actually yield when
  they need timer-driven cancellation; promises alone do not ensure a task yield.
  No ambient scheduler, public ShellLimits change or unbounded default is added.
- Result contains `state`, `kind` (`option`, `unknown-option`, `missing-argument`,
  `end`), `status` (0/1), `option`, `optind`, `argument` (`set`+value or `unset`),
  and `diagnostic` (unknown/missing intent+option or null). No variable mutation,
  name validation/binding, env lookup, output, filesystem, process or evaluation.
- `GetoptsError.code` identifies `INVALID_INPUT`, `NON_ASCII_OPTION`,
  `ARGUMENT_LIMIT`, `BYTE_LIMIT`, or `STEP_LIMIT`. Callback/abort reasons retain
  identity. Unknown/missing ASCII options are scan results, not thrown errors.

ASCII optspec/encountered option characters only; ordinary Unicode argument values
are supported. NUL is rejected. Non-ASCII optspec or an encountered non-ASCII option
is explicitly refused, not split into native bytes or treated as a JS-codepoint
option. All strings are validated within explicit work/UTF-8 byte limits; valid
surrogate pairs count four bytes and lone surrogates count the encoder replacement
width of three bytes. Only the selected option character is classified as an
option; Unicode in its required value is not an unsupported option.

Leading colon selects silent error intents. `reportErrors` represents an already
resolved OPTERR policy; the helper does not coerce OPTERR strings. `:` and `?` are
not valid option characters. Duplicates use the first occurrence. Required values
can be attached/separate, including empty or dash-prefixed values. There is no
permanent end latch: another call may resume after consumed `--`. Active argument
slot/offset survives a larger explicit index and applies to the current vector.
Builtin operand/usage parsing (including leading `getopts --`) is not this API.

Inputs and callbacks must obey the immutable-input contract until the promise
settles; hostile concurrent host mutation/getters/proxies are not sandboxed.
The helper never mutates input state/args. It publishes a fresh transition only
after all validation, checkpoints and final abort checks succeed. A rejected call
returns no partial transition and does not roll back callback effects. Clones do
not share mutable cursor objects. Later runtime binding can have different,
explicitly documented partial-write semantics; this helper does not certify them.

## Root policy and deferred stage 2

Preserve stronger readonly protections: **no getopts-only unchecked unset or
readonly-attribute removal**. Native evidence of Bash doing so remains intact;
future runtime behavior must disclose that divergence. ASCII option support also
differs deliberately from native non-ASCII byte parsing. Bash5.3 is the selected
scanner profile; Bash3.2 remains separate historical evidence.

Deferred: variable/name/OPTARG binding, OPTIND integer/coercion and origin hooks,
dynamic locals/function-entry cursor restoration, readonly outcomes, middleware,
positional/subshell/invoke integration, default variables and real budget adapter.
Owned-output's owner retains existing runtime/shell integration files.

## Evidence before candidate

`evidence/design-v1/archive.json` contains **all 21 original files**, including the
20-file seal and its manifest, as exact Base64 bytes with lengths/hashes. This
avoids newline changes and keeps historical scripts/native data out of TypeScript
and canonical test discovery. The original report contains historical proposals;
the root policy in this README overrides its unchecked-readonly proposal.

All **124 native observations** (62 scripts on each known binary), cases, drivers,
source/binary/env identities, report, fetch failures and seals are preserved.
Those are not 124 helper/runtime passes. `evidence/scanner-facts.json` freezes only
applicable Bash5.3 scanner projections and separately inventories excluded cases.
Each expected projection points to its exact original raw snapshot. Binding
effects omitted from projections are not being waived or counted as helper passes.

`node tests/shell/getopts/evidence/verify.mjs` verifies archive bytes, membership,
the original seal and frozen projections without executing a historical driver,
rewriting evidence, or using native binaries. `native-cohort.mjs --stdout` emits
the same frozen projection for audit only. Original scripts may be decoded into
a fresh task-owned temporary directory for opt-in replay; never run them inside
this committed evidence tree.

Scoped validation: run only this tree's `*.test.ts` with `node --import tsx --test`;
use `tsc --noEmit` with explicit owned helper/test inputs, or an isolated temporary
outDir, never the shared build/dist. Final checks/counts and limitations belong in
`evidence/phase1-validation.json` and the author handoff, not invented runtime claims.
