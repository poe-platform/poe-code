# Issue 780: complete static Python callback catalog

## Scope and acceptance

Maintain the build-time static-asset recipe and actual-workerd qualification for
the custom same-isolate Python executor. Do not modify the consumer or grant
dynamic compilation, unsafeEval, global engine patches, arbitrary extension
loading or managed Python mount acceptance. Issue 746 remains independent.

1. Authenticate pinned Pyodide 314.0.6 glue before parsing: 1250344 bytes,
   SHA-256 `2ac5eba365ec12839c75c03b39b3be1dd63b798852cc460b014b52238be042f7`.
2. AST-collect every literal `.sig` annotation, normalize wasm32 `p` to `i`,
   deduplicate and preserve `j`, `f`, `d`, `e` and void-result `v` semantics.
3. Generate exact import/re-export callback modules using the pinned padded ULEB
   encoding, statically precompile the full catalog and admit complete bytes only.
4. Require zero actual Worker rejection/error events after startup, every native
   execution/finalization/cleanup route and a final event-loop drain. Include an
   independent real-workerd negative control that passes buffered assertions but
   fails the identical zero-error assertion.
5. Main owns the disjoint literal input-registration edit, integration, commits,
   direct-main push and release monitoring. This worker does not commit or push.

External primary references: issue 780, consumer PR 14982 and consumer CI run
35409396941/job105805774321. The PR is reference evidence only, not a change
target or authority to create/merge a PR. The clean-startup job in run
35409969068 passed its Python startup check; its later 404 is a separate readiness
failure, not successful overall deployment evidence.

## TDD and current candidate evidence

Base: `8960ebd242ce1d3354babb2a741295c637d4eefc`, detached HOME worktree
`/home/kjopek/project/poe-issue-worktrees-20260918/issue-780-static-callback-catalog`.
All temporary logs and authenticated application assets are in its
`out/issue-780/`. Tooling dependencies may come from root node_modules, but bundled
all product package sources are the candidate's exact files, checked against
esbuild's input graph, with an explicit candidate safe-bash-contracts source
alias as well as safe-bash/safe-fs. No symlink-installed public consumer is used.

- Initial catalog/error-gate unit RED: the requested helper imports did not exist.
  Separate maintained regression reproduces the exact reported `vi` bytes being
  rejected by the existing helper-only static registry.
- Actual-workerd old-recipe RED (`workerd-event-gate-red.log`): all existing
  buffered Python/native/finalization assertions completed, but the final
  Worker event gate retained **10 unhandled rejections**, each
  `CompileError: Unapproved Python runtime Wasm bytes`. The independent negative
  control passed, proving the gate sees real Worker rejections.
- Exact-candidate controlled-omission RED (`workerd-candidate-omission-red.log`):
  after strengthening source admission to every product package input, temporarily
  set only the owned callback list to empty, restoring the old helper-only asset
  recipe. The same ten unhandled CompileErrors fail the gate after all buffered
  assertions complete; the independent negative control passes. Restore the full
  catalog immediately afterward. This removes the initial historical run's
  dependency on root-built contract assets at the same base.
- Diagnostic-channel-only negative control RED (`workerd-red.log`): structured
  logging/uncaught-error callbacks alone did not report the intentional rejection.
  Therefore the maintained gate uses standard Worker events, not buffered output
  matching or those diagnostic callbacks alone. No preventDefault is called.
- Full-catalog actual-workerd GREEN (`workerd-green.log`): both tests pass,
  96 callback assets statically precompiled, zero retained Worker errors; native
  I/O, imports, exact binary streams, asynchronous finalization, background/task
  retirement, cancellation, shell disposal and proxy cleanup assertions pass.
  The isolated negative control retains exactly its intentional CompileError
  while returning a successful buffered response, and the zero-error assertion
  correctly rejects that evidence. It is not part of the positive interpreter.
- Final exact-candidate combined GREEN (`final-verification.log`): 12 tests pass,
  no failures or skips, with all product package inputs admitted beneath the
  candidate root. Narrow ESLint passes for all five changed MJS inputs under
  the maintained guard's supported version 9.39.4. Root tooling's ESLint 9.39.5
  was rejected by that guard; use the existing issue-746 dependency tree solely
  as tooling, never as a product-source overlay.
- Catalog unit GREEN covers pointer deduplication, all Wasm types, literal-only
  AST extraction, syntax/type rejection, exact `vi`/`vii` padded bytes, count
  boundaries, glue authentication and complete-byte mutation rejection. The
  authenticated pinned-input test independently counts 1295 annotations,
  184 distinct raw signatures and the 96 normalized modules.

## Reproduction

Provide the exact five authenticated Pyodide files under an owned directory
selected by `SAFE_BASH_PYTHON_RUNTIME_ROOT`. The unit tests only read inputs and
operate in memory; they do not write filesystem fixtures. Without this explicit
environment the pinned external-input unit case is reported as skipped, not
counted as a qualification pass.

```bash
export SAFE_BASH_PYTHON_RUNTIME_ROOT="$PWD/out/issue-780/runtime"
node --import tsx --test packages/safe-bash/tests/integration/python-jspi-catalog.test.mjs

export SAFE_BASH_CF_RUNTIME_ROOT=/home/kjopek/project/poe-issue-worktrees-20260918/issue-763/out/issue763-workerd
export MINIFLARE_WORKERD_PATH="$SAFE_BASH_CF_RUNTIME_ROOT/workerd-local.sh"
export TMPDIR="$PWD/out/issue-780"
node --import tsx --test packages/safe-bash/tests/integration/python-jspi.test.mjs
```

Toolchain: Miniflare `5.20260917.0-alpha`, workerd `1.20260917.1`; the authenticated
HOME wrapper launches that binary with the existing HOME glibc sysroot. No /tmp
toolchain, container-mounted source replacement or managed-native probe is used.
The observed positive sample used 31457280 linear-memory bytes and approximately
1256 ms for initialization plus script; these are observations, not RSS bounds
or benchmarks.

## Qualification limits

This worker qualifies candidate workspace source in actual local workerd only.
It does not claim packed/public-consumer qualification, deployed consumer
acceptance, managed Python filesystem acceptance, release publication, runtime
preemption or guest confinement. The finite authenticated callback catalog is
not admission for new unlisted user callbacks or downloaded extension modules.
Root must independently validate integration and delivery.

## Root integration qualification

Integrated into the main checkout on September 19, 2026. Registered all three
new integration inputs by exact literal path in the maintained input gate.
That selective registration test passes. The combined catalog and native
workerd source qualification passes all 12 tests with zero skips and zero
retained positive-runtime errors.

An independent npm installation of public safe-bash, safe-fs and safe-js
`0.1.695`, with no workspace package links, also passes both native workerd
tests using the complete static catalog. Its deployable assets and manifest
were generated under the main checkout's owned `out/issue-780/public-assets`.
This qualifies the existing public runtime with the corrected recipe, not a
new managed Python backend or an actual deployed consumer. Neither a local
commit nor these qualifications establish remote delivery or publication.
