# csvcut CLI, SDK and installed export verification

This wiring increment uses the existing private projection and CSV engine.
The package pattern was read from its existing archived location,
`docs/plans/archive/safe-bash-command-package-pattern.md`; the deleted original
was not restored. Unrelated edits were preserved. No XAN sources were imported.

## Delivered interface

`safe-bash-command-csvcut` stays private, TypeScript ESM, with empty runtime
dependencies. Its first-party development dependency on `safe-bash-contracts`
provides canonical byte argument, error, output and plugin ownership. The
qualified `poeCode.integration.privateWorkspaces` profile and lockfile reflect
that edge. Safe Bash's existing `./commands/csvcut` entry only re-exports the
command package; the maintained publisher bundles implementations and rewrites
declarations. No default registration changes or standalone publication occur.

Exports: `csvcut(context, invocation?, configuration?)`, `csvcutCommand`,
`createCsvcutCommand`, `csvcutCommands`, `parseCsvcutArguments`,
`CsvcutInvocation`, `CsvcutCommandOptions`, `CsvcutResult`, plus existing byte
projection/engine exports. Results expose `exitCode`. CLI and SDK use `cutCsv`
with the same invocation ledger; caller-owned shared ledgers are not disposed by
projection. CLI grammar includes grouped/attached short flags, long equals,
last-value precedence, `--`, stdin and literal VFS operands.

## Independent controls and TDD

The first command control failed because the requested command module did not
exist. A producer EOF-retirement control then failed (zero returns); wiring now
owns one idempotent return. The shared-ledger control initially failed to reject
output beyond a previously charged quota. Standalone grammar retained-allocation
admission failed with a zero retention allowance. A producer changing its `next`
method after delivery triggered the replacement; wiring now captures `next` and
preserves its receiver. The codec parity control found SDK `latin1` admission;
CLI and SDK now reject it before input acquisition. The field-size grammar control found malformed `-z`
values returning capability status 1; integer validation now precedes capability
rejection and returns usage status 2. Each repair followed its
observed failing control.

Literal expected-output controls cover repeated projection, tab precedence,
zero-column records, width-three names with zero origin, empty ordinary input,
unknown/source-only flags, missing values, names/headerless errors, literal VFS
paths, short/excess rows, projected row deletion, byte chunk boundaries and
producer storage reuse. Further cells cover canonical invalid UTF-8 argv,
awaited sinks, bounded fallback reads, output quota atomic admission, option
snapshots, cooperative cancellation with a falsey reason, registered cleanup,
retirement and middleware/pipeline/redirect status. Unit VFS is memory-only;
network is forbidden in shell controls. Native executables are not test inputs.

## Compatibility scope

Selected release: csvkit 2.2.0, not later source-only flags. Reader:
`utf8-sig-permissive-v1`; selectors: `csvkit-2.2.0-ascii-v1`. These existing
candidate profiles are not full Python 3.9/agate compatibility. Output is
comma/LF; no inference, locale, null conversion or Sniffer is added. Codec aliases
are explicitly admitted and never inherited from host environment.

Successful operations return 0; grammar failures return 2; runtime CSV/VFS and
unqualified capability failures return 1. Deterministic adapter diagnostics use
`csvcut: <message>\n`, within invocation quotas. Exact native argparse usage,
tracebacks and selector error wording remain unqualified. Unsupported codec,
NONNUMERIC/ALL quoting and native character field limits remain explicit failures;
verbose/native tracebacks and long abbreviations are rejected. Python strictness,
NUL/codec errors, complete replay and actual browser/workerd/Bun runtime gates
remain open. No full compatibility or whole-artifact zero-dependency claim is
made. The command adds no host executable, ambient file, network, native/WASM,
download or fallback capability.

## Verification receipts

- Command workspace: `npm run lint --workspace=safe-bash-command-csvcut`
  passed, including source/test typechecks; `npm run test:unit` in that workspace
  passed all 93 controls after the final field-size grammar repair.
- Shell integration: both `csvcut-wiring` memory-VFS controls passed.
- Publication unit controls: all 155 `scripts/package-safe.test.ts` cells passed;
  the narrowed external-contract declaration fixture retained strict assertions
  and the original timeout, with its installed graph cell taking about 1.5 s.
  Earlier expanded/saturated runs failed and are not counted as passes.
- Maintained selected Safe Bash build closure and `scripts/package-safe.mjs`
  staging passed. No alternative sibling compiler or held-source extraction was
  used for production artifacts.
- `npm run lint:eslint -- --no-cache`: complete, exit 0, zero errors, four
  warnings; all 16,140 configured subjects processed, zero cache hits. Subject
  counts describe this receipt, not future task membership. Final focused
  ESLint also passed. Repository `lint:types`, package lint and workflow lint
  passed. `git diff --check` passed.
- Three public candidates at `0.0.0-csvcut-grammar` were packed without lifecycle
  scripts and installed offline with scripts disabled into a fresh consumer
  outside the checkout. No private command, contracts or engine package was
  installed. The maintained private-command runtime fixture passed, including
  canonical contract identities, Shell-created invalid byte argv, csvcut
  CLI/SDK parity, field-size grammar, cleanup and unchanged default registration. The complete
  installed declarations passed strict NodeNext compilation with exact optional
  properties and unchecked indexed access. The unit graph separately executed
  in a Buffer-free Node VM realm; actual browser/workerd/Bun engines are not
  qualified by that check.
- Installed export targets: `./dist/safe-bash/commands/csvcut/index.js` and
  `./dist/safe-bash/commands/csvcut/index.d.ts`. Tarball SHA256 receipts:
  Safe Bash `e89218b08f7fb5ee1c9b5d0cd9410debdcafdb1ceb76a733783abe5879cec721`;
  SafeFS `1ba6e55e76c773ab17580ebba9c9533669d5d3aad653eec22cfea928869986f7`;
  SafeJS `e962c058c8bd3d52dd6a70e551f95ec01e42e43fc85d88d99f6bee9a75ee8f05`.
- Ad hoc maintained screenshot capture rendered installed help, names and
  projection, usage errors and required-header errors. The screenshot was visually inspected: names are aligned,
  projection is readable and output agrees with literal controls. No screenshot
  tests were added; csvcut native executable QA was not run.
- `npm test -- --no-cache` completed with exit 0, including every maintained
  declared workspace unit route, prerequisite builds, native npm pre/post events
  and both root post-test stress checks. Its receipt reports `UNCACHED`, 90
  workspaces, 37 prerequisite builds and 58 unit routes; these describe the
  executed declarations, not fixed task membership. Missing test declarations
  remain `NO_DECLARED_TEST_NOT_A_PASS`; unavailable optional cases are not
  counted as passes. Shared batches retain two skips. Safe Bash passed 41,911
  cases with 829 skips and zero failures; all 563 guarded checks passed. SafeJS
  passed 31,121 cases with 48 skips across 1,470 files (three skipped files).
  Safe Python passed all 84,595 cases across 1,151 files. Root post-test stress
  passed both controls.
- The final field-size grammar control was added after this full run's command
  stages had finished. Final source was then verified separately with all 93
  command controls, both Shell integration controls, source/test typechecks,
  scoped lint, all 155 publication controls, guarded build/staging and the fresh
  `0.0.0-csvcut-grammar` isolated installed runtime/types receipts above. The
  field-size usage and capability diagnostics were also captured in a screenshot
  and visually inspected. No shared infrastructure changed in that final repair.
- Earlier full attempts encountered declaration-fixture errors/timeouts and a
  stress-cell timeout under host load. They do not qualify the full gate. One
  overlapping build attempt was interrupted to keep artifact builds sequential;
  it is not counted as a pass. No deadlines, assertions, profiles or versions
  were weakened. The corrected full route passed as recorded above.

Generated logs, tarballs and screenshots use repository `out/csvcut-wiring`
because the host's absolute `/out` is read-only. The offline installed consumer
uses a temporary directory outside the checkout so parent workspace modules cannot
satisfy missing private imports. Task-owned evidence is purged after capture.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No push, release or private-package publication was requested or performed.
