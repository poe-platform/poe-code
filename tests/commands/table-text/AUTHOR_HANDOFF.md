# Table-text author handoff — August 27, 2026

## Source and API

- Initial author source: `9d1e0fa`; shared Buffer ownership fix: `32513a4`.
- Root/aggregate integration and frozen verification source:
  `33347b76def1b2cbbe3f399b3be330d3f40e6a50`.
- New commands are **paste, comm, join**. Existing standard cut is not duplicated.
- Root and `virtual-bash/commands/table-text` export:
  `tableTextCommands(options?: TableTextCommandsOptions): VirtualShellPlugin`,
  `createTableTextCommands(options?: TableTextCommandsOptions): readonly CommandDefinition[]`,
  `TableTextCommandsOptions`, and `TableTextLimits`.
- Options: `{ replace?: boolean, limits?: Partial<TableTextLimits> }`.
  Aggregate forwarding: `agentCommands({ tableText: { limits } })`. One top-level
  aggregate `replace` remains authoritative. The literal registry fixture names
  all56 defaults; optional curl/SafeJS remain excluded. Runtime dependencies: zero.

## Evidence, not independent acceptance

`author-verification.json` records source hashes, exact native binary identities,
log hashes, commands/cohorts and limitations. The snapshot is a git archive of
the revision above with cached development dependencies linked, no source overlays.
Global typecheck and build pass. **311/311** scoped tests pass, zero skips/TODOs:
260 table tests,31 aggregate tests,20 unchanged diagnostic/jq interop tests.
The six built-package checks pass, including eleven fixed export/declaration
entries and actual binary VFS pipelines.

The GNU9.7 C-locale corpus has216 observations: **215 matches and one explicit
disagreement**, not216 matches. GNU9.7 Darwin `comm - -` emits matching stdout
then exits1 with an EBADF duplicate-close diagnostic; the virtual shared cursor
closes once and exits0. The same native binary hashes and all frozen observations
were rechecked. Ordinary diagnostic text is not claimed byte-for-byte GNU parity.

The resumed257-test baseline passed before three new byte-ownership probes failed.
`Buffer.slice()` shared producer memory across an unfinished record. The shared
reader now copies into a plain Uint8Array. All three old byte failures remain in
`buffer-ownership-regression.json`; expected bytes were not altered. The updated
260-test family suite passes. This is **author testing**, not different-agent
stress/fix acceptance. An initial ad-hoc ES2022 type invocation incorrectly used
an older target than the repository; the corrected ES2023 scoped check and frozen
project-config typecheck both pass. No shell change was made to accommodate it.

## Reproduction

From an archive of the source revision, link/install matching dev dependencies.
Set `GNU_TABLE_BIN` to an existing coreutils9.7 binary directory; this run reused
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src`.
Nothing was installed or added to runtime dependencies.

```sh
npm run typecheck
npm run build
node --unhandled-rejections=strict --import tsx --test \
  'tests/commands/table-text/*.test.ts' tests/plugins/agent-commands.test.ts \
  tests/integration/adapter-tools-diagnostics/eight-cases.test.ts \
  tests/commands/structured-stress/split-increment/interop.test.ts \
  tests/commands/structured-stress/final-increment/fresh-interop.test.ts
```

Without the optional GNU path the live recheck explicitly skips; frozen product
cases still run. Do not count an unavailable external oracle as a native pass.

## Independent reviewer priorities

- Run new differential cases beyond the216 frozen observations: asymmetric EOF,
  headers/outer join, duplicate products, repeated field/delimiter options,
  order errors and NUL/invalid UTF-8 bytes. Preserve native expectations.
- Stress producer reuse, chunk boundaries, shared stdin cursors, output
  backpressure, producer errors and cancellation during VFS work. Preserve exact
  partial bytes and distinguish cooperative cleanup from noncooperative hosts.
- Exercise explicit quotas without resetting budgets or hiding failing output;
  duplicate groups and chunks/records have separate bounds.
- Test actual required remote/wrapper reads and literal/symlink paths; author
  integration covers memory, real and readonly, not all provider deployments.
- Keep unknown flags, C/POSIX-only ordering, argument/record limits and the comm
  disagreement visible. Source README specifies implemented options and gaps.

Core consumer independent review of `f291156` and Poincare's backend positive38
plus guards remain separate pending gates. This delivery does not close those
gates, establish full utility parity, demonstrate superiority or satisfy72 hours.
