# Single sink-fixture migration v2 — author replay 19/19

**August 27, 2026. Test-only migration author capture; separate reviewer acceptance
is pending.** The revised 19-case cohort passes with the **same pinned product,
actual private engine, emitted package, tooling and case inputs** as the original
18/19 audit. This is one authorized assertion migration plus a versioned replay
provenance correction, not a production fix or broader SafeJS parity claim.

## Sole assertion migration

Only `literal-grep-caller-sink-error` changes expectation. It requires no rejection
and the complete exact result:

```json
{"exitCode":2,"stdout":"","stderr":"grep: sink:literal-grep-caller-sink-error\n"}
```

The branch has an explicit case-ID guard. `FIXTURE.patch` is the exact change from
`5009ba8146c73bd5628147707e733384e5cd4aee`. The candidate is byte-identical to the
previously authorized, uncommitted v1 candidate. Its SHA-256 is
`528234e9127066607a87ffde499e462189fd092513c9e08f6770f29536ecb7b9`.

Before that edit, pinned `src/commands/grep.ts:77` was inspected: cancellation is
rechecked, ordinary errors are diagnosed, and `failed` selects status 2 at line
84. `src/commands/internal.ts:101` emits the exact command-prefixed diagnostic.
`src/contracts/command.md:99` preserves the selected outcome after draining;
it does not make a caught utility error an execution rejection. The existing
rejection test at
`tests/commands/regex-execution/cleanup-registration/controls.test.ts:171`
also throws from **stderr**, unlike this fixture. No native Bash proof is claimed.

`verify.mjs` proves that replacing only the original two assertion lines yields
the entire candidate child. Guest code, shell command/argv, VFS input bytes,
Error construction/message, throw point, runtime injection, budgets and all
cleanup/native-worker probes are unchanged. All other 18 cases—including the
separate sink-status control and Error/record caller-abort identity controls—are
unchanged. Actual selected case metadata, argv, output/result and error observations
match the original capture for **all 19**; only this assertion's outcome changes.

## Why a versioned runner is necessary

The unchanged historical runner authenticated the full historical archive, but
then also required the evolving **live checkout** to equal that old archive.
The v1 attempt correctly preserved its early guard failure: zero guests executed.
Root authorized replacing only this mistaken identity prerequisite in a **new**
runner. The original `../../run.mjs` remains unchanged at SHA-256
`144a774b92b7360891e73ae53b50689aad9875f4f2f1dea3a0f79684f46f6305`.

`RUNNER.patch` shows every change from the original runner. Mechanical changes
locate the common harness from the versioned directory and optionally select
immutable original fixtures. No original capture metadata is rewritten.

| Boundary | v2 rule |
| --- | --- |
| Product identity | Full archive of `f44958bf48778737a58535e2bc9b37c292ac28c4`, not current HEAD |
| Committed contents | All **15,798** regular files checked against pinned blob IDs, modes, file set and tree hash before build, after build, before execution and after execution |
| Emitted product | Entire dist inventory equals the original accepted package; rechecked after build/execution |
| Package | Offline tarball hash and unchanged manifest/exports equal the accepted capture; installed dist equals emitted dist |
| Live checkout | Read-only before/after source/config inventories, HEAD/index/status and differences recorded separately; never overlaid or imported |
| Private engine | HEAD `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`; all 264 copied regular files equal accepted engine bytes; before/after HEAD/index/status/metadata/files unchanged |
| Actual imports | Original ESM/CommonJS/loader/native guards and negative controls remain byte-identical and inventory-bound |
| Runtime profile | Exact Node 22.22.2/Darwin arm64, cached tooling bytes, child options/deadlines and fixture hashes match the original profile except the sole assertion |
| Settlement | Original native exit/termination-before-public-settlement assertions, exact caller identity and no-rescue acceptance remain unchanged |

The full tree hash is `b56256393025d5f0cf0d2b33c05bd5d5f39ac608`.
Archive SHA-256:
`d942398b277a621b82b98dbaab267291ac4dc7b613f884b617650357964989bd`.
Package SHA-256:
`1a757856aff57daa1fd3e5c40f4e011b1bb1ec43877f2fd5c8b6fae7f8e3ff5e`.

The new runner adds stricter archive/emitted/private final checks; it does not
replace them with a live-tree exception. The verifier also checks byte equality
of the old/new private-state helper, public negative-control block and child
execution/acceptance loop. Runtime guard files, cases and original runner retain
their original hashes.

## Capture and cleanup

Raw evidence is `../../evidence/sink-migration-v2/report.json`; capture runs from
**10:21:17.167 to 10:22:01.525 UTC**, August 27, 2026.

- **19/19 pass**: 18 actual guest executions plus one no-admission pre-abort control.
- All **18 native regex workers** exit and fulfill their native termination
  promises before public `Shell.exec` settlement. Existing disposal/inner Shell
  ownership checks also pass. No added delay or changed resource probe.
- All **19 esbuild service children** close normally, and all strict test children
  exit 0 without signals/timeouts. No watchdog rescue or foreign process kill.
- **9,866 import-record hashes** match the audited regular-file copies. Private
  state, copied runtime files and cached tool sources remain unchanged.
- The full owned archive/consumer/tool tree is removed after saving evidence.

Live `src/commands/internal.ts` and `src/commands/streams.ts` differ from the pin;
`streams.ts` changes again during this replay. Those differences are captured in
`live-before.json` and `live-after.json`, without attributing authorship. The
archived product remains unchanged through every verification phase. This is
direct evidence that live drift was not substituted for product identity.

## Original audit and independent replay

All **572 other original owned files** remain byte-identical to `5009ba8`, including
the original author README, original runner, all prior raw attempts, and immutable
attempt-08 harness versions. The original full audit remains **18/19**. The failed
`sink-migration-v1` capture and blocker report are preserved as historical evidence;
this v2 authorization resolves the orchestration prerequisite, not its old result.

Original child SHA-256:
`70708a7d07fd61595933b08f5ec852f6b8cc5d60f15724239023775318b71ee7`.
The `--original` profile reads all six original fixture files from
`../../evidence/attempt-08/harness/*.fixture`, authenticates their recorded hashes,
and copies them unchanged into the same package/engine consumer. It does not
reverse-patch or synthesize an old assertion. This profile is provided for the
separate reviewer; no additional original-cohort replay is claimed in v2.

From the repository, using **fresh** evidence destinations:

```sh
node tests/integration/safejs-cleanup-regression/integration/migrations/sink-v2/run.mjs \
  tests/integration/safejs-cleanup-regression/integration/evidence/NEW_REVISED

node tests/integration/safejs-cleanup-regression/integration/migrations/sink-v2/run.mjs \
  tests/integration/safejs-cleanup-regression/integration/evidence/NEW_ORIGINAL \
  --original literal-grep-caller-sink-error

node tests/integration/safejs-cleanup-regression/integration/migrations/sink-v2/verify.mjs
```

The first command expects revised 19/19 and exit 0. The second intentionally uses
the original failed assertion, expects exit 1, and must still record the same
status-2 behavior with completed ownership. Omitting the case ID with `--original`
selects the immutable original 19-case cohort. No new cases are introduced.

`VERIFICATION.json` is the author's offline equality/provenance verification, not
independent reviewer acceptance. The old audit README and old verifier continue
to describe their frozen original version, not this migration. No all-engine
parity, raw-host semantics, general surface/architecture proof, environment code,
production lease, source fix or new feature is claimed. Stop after the atomic
test-only commit and handoff.
