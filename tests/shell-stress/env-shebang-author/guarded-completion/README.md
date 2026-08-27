# Guarded completion author evidence

## Candidate and scope

Source/regressions commit: `ea409a6b49d5c1523e3238f0384048218b559c4c`.
Parent: `91464989ff4c563195330cc3a7cacc4500c0bad0`.
Committed August 27, 2026, 15:19:45 UTC. The first explicitly recorded work
timestamp was 15:12:08 UTC; this is not a claimed task-start timestamp or a
72-hour work claim.

Only these product/test paths are in that atomic commit:

- `src/shell/runtime.ts`: imports, new private shebang helpers and `envShebang`.
- `tests/shell/env-shebang.test.ts`: added 11 guarded regressions and a type import.
- `tests/shell/env-shebang-host.test.ts`: added eight bounded child probes.

No ordinary invoke/invokeScoped, executor, discovery, parser, env core, contracts,
package/export, private checkout or independent-review input was edited.
`interpreter`, `scriptFile` and `processState` remain unchanged and are reused.
ROOT authorized a guarded literal-target policy replacing the earlier author's
closed bash/sh-only engineering policy. Independent `dc262a99`/`fb10ee85` remains
historical **27/30**. Only the three disclosed failures and the design handoff
were read; the hidden replay corpus was neither inspected nor changed.

## Behavior and accounting

- Literal bash/sh uses the existing reserved interpreter and preserves a selected
  registered-name override refusal of 126. Matching loaded shell source is still
  read once and succeeds at the existing depth-one boundary.
- Slash-containing operands use direct VFS `scriptFile` checks, with no basename
  normalization, host execution or outer-source cache permission bypass.
- Other exact registry names pin the definition before selected-target middleware.
  Shell functions/builtins cannot shadow that selection. Missing bare names return
  127 without PATH, same-directory file lookup or fallback after failure.
- A scoped synthetic env stage runs middleware with unsplit optional argument,
  original script/user argv, incoming exports/cwd, streams and provenance. Its
  terminal is the accepted env handler, not registered env. It adds no command or
  depth charge. Selected target middleware runs as well.
- Replacement registered-target env is exact, including omitted/empty env, without
  PWD/local promotion. Existing shell-process initialization remains normal.
  Replacement streams retain explicit provenance, share budgets and close owned
  input; transparent input is forwarded without consuming or owning its cursor.
- Generic registry/VFS delegation consumes shared depth/command/source budgets.
  A selected registry handler's own nested invoke retains ordinary existing
  resolution; neither that execution nor script bodies are recursively restricted.
- Child invocation scopes register cleanup before owned input acquisition, enforce
  admission and close in finally. Cancellation interrupts and observes losing
  promises without draining opaque host handlers. Registered cooperative cleanup
  is awaited; scope closure is distinct from caller cancellation.
- Only the pinned env handler's downstream invoke is protected against its define
  wrapper converting errors into status 1. Captured failures are rethrown within
  the env terminal, so wrapping middleware sees the original object. Status
  validation remains active. Ordinary non-abort errors retain Shell's existing
  status/diagnostic behavior, not a new public rejection contract.

## Checks and retained failures

All counts below are top-level Node tests, with no skips, cancellations or TODOs.
These are **live scoped author checks**, not an immutable full gate or a replay.

| Check | Result | Artifact |
| --- | --- | --- |
| Guarded-only author tests | 19/19 | `guarded-only.tap` |
| Both complete author files | 47/48 | `fourth-author.tap` |
| Unchanged env core/invoke controls | 125/126 | `core-controls.tap` |
| Unchanged script/interpreter controls | 203/210 | `script-controls.tap` |
| Unchanged lifecycle/provenance controls | 125/125 | `lifecycle-controls.tap` |
| Build | exit 0 | `candidate-build.log` |
| Scoped strict TypeScript | exit 0 | `first-strict.log`, `tsconfig.scoped.json` |
| Source and owned-test diff whitespace | exit 0 | executed before source commit |

All eight old core/script refusal conflicts remain unchanged: the core
`literal-single-optional-argument` refusal and seven script/interpreter refusals.
Their raw failure diagnostics are preserved in the two control TAP files; none
was waived, rewritten or credited as a pass.

One additional prior author assertion now conflicts with the newly approved
policy: `registry, function and PATH names cannot hijack the reserved interpreter`
expects registered `alien` to return 127; it now returns its pinned handler's 37.
The assertion, and its earlier registered bash override checks, remain intact.

Bare `#!/usr/bin/env` now selects its explicit `/program` operand as a direct VFS
target, rather than the prior closed-policy 127. A new bounded author case proves
it reaches shared `maxSubstitutionDepth: 4`; no native-equivalence or universal
termination claim is made from this profile. Generic VFS and registry cycles
also exercise command and source ceilings without entering the original body.

The 19 new tests cover the three gaps, exact argv/env/cwd/input/provenance,
registry pinning against middleware replacement, function/builtin shadowing,
PATH refusal, direct VFS access/type/binary/interpreter errors, outer-source
permission changes, transparent pipelines, uncharged reserved middleware,
middleware short-circuit/wrapping/errors/validation, replacement sink limits,
owned input return, closed admission, opaque env/target handlers, caller reason
identity, cooperative cleanup failures and target middleware cancellation.

## First attempts are retained

- `first-implementation.patch` plus `first-implementation.sha256` preserves the
  first source draft. `first-build.log` retains its eight TypeScript errors:
  missing required invoke initialization and attempts to assign readonly invoke.
  The repair uses a typed closure-backed invoker, with no contract changes.
- `second-build.log` records the repaired successful source build.
- `first-author-runtime.patch` and `first-author-tests.patch` preserve the first
  author-run inputs. `first-author.tap` is 24/27: the preserved old-policy conflict
  plus two new test defects. One incorrectly expected ordinary Shell errors to
  reject; another used an unsupported hyphenated function declaration.
- `second-author.tap` is 25/27: the preserved conflict plus the new diagnostic
  assertion's wrong `exitCode` spelling. The final test checks the exact existing
  `Exit status must be an integer between 0 and 255` diagnostic instead.
- `third-author.tap` is 44/45 before the last two direct tests and eighth bounded
  host scenario were added. Its sole failure is the preserved policy conflict.
- No prior candidate or raw failed capture was overwritten. The first authored
  candidate `dc262a99` and its original evidence also remain untouched.

## Reproduction and profile

Node `v22.22.2`, npm `10.9.7`, TypeScript `5.9.3`, Darwin `25.4.0 arm64`.
Native tests retain their existing hash-pinned GNU env 9.7/Bash 5.3 and Apple
env/Bash 3.2 Darwin profiles and their existing single-optional protocol versus
actual Darwin kernel distinctions. No native inputs, pins, expectations or
profile labels were changed. No new external semantic facts are asserted.

From the repository root, use a fresh output directory if recapturing:

```sh
npm run build
node_modules/.bin/tsc -p tests/shell-stress/env-shebang-author/guarded-completion/tsconfig.scoped.json
node --import tsx --test --test-name-pattern='guarded completion' tests/shell/env-shebang.test.ts tests/shell/env-shebang-host.test.ts
node --import tsx --test tests/shell/env-shebang.test.ts tests/shell/env-shebang-host.test.ts
node --import tsx --test tests/shell/env-split-native.test.ts tests/shell/env-split-host.test.ts tests/shell/env-split-limits.test.ts tests/shell/env-replacement.test.ts tests/shell/invoke.test.ts
node --import tsx --test tests/shell/script-entrypoint.test.ts tests/shell/invocation-modes.test.ts tests/shell/errexit-host.test.ts tests/shell/expanded-gaps-env-host.test.ts
node --import tsx --test tests/shell/invocation-cleanup.test.ts tests/shell/invocation-cleanup-lifecycle.test.ts tests/shell/invocation-cleanup-pipeline.test.ts tests/shell/invocation-cleanup-public.test.ts tests/shell/invocation-cleanup-setup.test.ts tests/shell/stdin-origin.test.ts
```

The scoped TS configuration checks both author entrypoints and their transitive
source imports. It does not certify all test fixtures, consumers, the package
release gate or a full repository typecheck. Existing moved built-package and
native probes are included in the complete author run, not a new packed release.

## Integrity and cleanup

The candidate owned source/test hashes are in `manifest.json` and the ROOT handoff
`/tmp/safe-bash-env-shebang-guarded-candidate.txt`. The hash manifest authenticates
the listed captured artifacts; it is not a before/after or append-proof live-tree
seal. Other owners continued work: a later status observation showed their
`src/commands/text.ts` edit and a new independent review output directory. Those
inputs were not edited, staged, read or used to claim immutable author acceptance.
The tracked independent-review tree compared unchanged against `fb10ee85`;
that tracked comparison does not reject new entries and is not an append-proof
integrity assertion.

Each new bounded host test asserts its child exited without timeout/signal and
that its PID is absent. Existing host tests retain scratch removal and child
settlement checks. All author/control commands finished; no worker was spawned,
and no owned worker, watcher or running child remains. Opaque promises in bounded
children are intentionally not forcibly drained; that is not a promise to stop
uncooperative host work. No full gate, parity, deployed-provider, superiority,
performance or elapsed-72-hour claim is made. Independent replay remains ROOT's
separate task against the committed candidate.
