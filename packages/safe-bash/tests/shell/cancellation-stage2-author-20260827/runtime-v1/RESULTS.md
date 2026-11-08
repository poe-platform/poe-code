# Stage2 runtime author result

This is author evidence for Root and Poincare review, not independent acceptance or a whole-gate result.

## Bound candidate

- Fixed baseline: `12e196af8d8b0866339747150b02ca00b9764a09`.
- Accepted helper: `57855a0293edb83bff98113123806497b4427416`; `src/shell/cancellation.ts` remains blob `a0e68c7bfb2d541964194d38ef30a4a590bec1de`, SHA-256 `2685ad5723036ef217881e3c3b5f62882a2647e287f518d3cfd4f8416fc330a2`.
- Five-file source commit: `fd1daa123298568546d9ea4e95f8c81dde9c52ff`.
- Poincare preintegration freeze authenticated at `98f400c4a33eeb03f825213054f90adc1fd979c4`; the approved R08-v3 effective fixture hash is `b6ff804f0397907930fb41cbe17eb8bd4caf60a4edc2b424341aa80c1c204b7f`.
- Design commits authenticated: `82687013db952e765b81db458410777850982ef5`, `7958e786c9566653d8da693e7d991a6f63de08a0`, and `90499562b73767fa983cd675b8349afbd2acd58d`.

The synthetic product input is fixed-baseline product source plus the exact helper and the exact five candidate blobs. It excludes every other live-HEAD change, concurrent `77which`/TEMP/native artifacts, full-gate driver work, and independent-test work. Live AGENTS files were read as instructions but excluded from product reconstruction; no AGENTS file was copied, archived, generated, installed, or modified.

## API and runtime closure

`CommandInvokeOptions.signal` and `ShellInvokeOptions.signal` are both `readonly signal?: AbortSignal | undefined`. The omitted, explicit-`undefined`, and borrowed paths retain the parent signal and allocate no Stage2 cancellation owner. Invalid values and pre-aborted ancestors fail before child activation; the options getter is read once.

Owned cancellation is prepared inert, registered with the enclosing invocation cleanup scope before activation, and finalized through one shared idempotent barrier. Activation rollback and public settlement close/detach listeners. The parent invocation is borrowed and never closed by a child. Existing depth/command admission and the original budgets, streams, middleware, cwd/environment/argv state remain in use; no shell, budget reset, deadline counter, timeout command, or `Promise.race` was added.

Outcome provenance is bound to the exact invocation/raw promise boundary. Only a tagged trusted runtime-cancellation branch can produce a cancellation report; equal rejection reasons do not establish provenance. Async wrapping loses proof conservatively. Existing handler-error-to-status mapping explicitly discards a report, which keeps R08's outer status `1`, wrapper status `0`, and live root caller behavior. Selection runs after registered cleanup drains: child ranking is root caller, captured escaping execution/control failure, ranked invoke cancellation; the root barrier is caller, execution, cleanup, numeric result.

Original root caller/control lineage is seeded by `Shell`, propagated through actual command invocation, dispatch, env/shebang forwarding, and original pipeline controls. Pipeline EPIPE behavior stays on its established numeric mapping path. Root cleanup callbacks seal admission but do not await their own root close. `dispose()` shares and awaits active owner finalization.

## Reconstruction and validation

`RECONSTRUCTION-FILES.json` records SHA-256, byte length, and mode for all 254 fixed product-input files. `candidate-source.tar.gz` contains only those product inputs and no AGENTS entry. Its SHA-256 is `51b9013eb0ac70849059403cddf22d5f8f0fab360da7a41e308ae0ca88595e87`.

Construction archives were checked before extraction and remained immutable:

- baseline tar: `38bfca803bfcf061fc4009cd2d7abe262aaf6cbcbcf7b7d1a04d680e656834d7`
- exact helper tar: `08e686802b39f28ebbb63b57a3aae171916cf61a64c430ad7733ed223ef3b490`
- exact five-candidate tar: `1177673ebd0c2a82b96bafce8169b531ad9c11b65cc08108d738801db07d23d0`
- versioned fixed-baseline test support v2: `30f6de4b70a49d59d3bfbd67e7f4118540be56e9d7d0146301f0fc36297f4fa1`
- v3: `4cfef7cc0c37be4e0991e1efc09c9567b1883f2763df177f78e3a43685d7805e`
- v4: `23df73863c7612bfbb06fa1180f6ee50f0413a3084c0c4fcd49dff3087126364`
- v5: `e0eb25b4b8f5caa493a26742ae037b3328a5c9732b62ff52e9776adb660d2370`

The copy guard used `lstat`, rejected symlinks/nonregular files and every `AGENTS.md` basename, copied bytes and modes, then required an identical post-copy inventory. Its scope was the author test tree and isolated TypeScript/tsx/Node type tool inputs; no product source was taken from mutable live HEAD.

On the exact reconstruction: strict build passed; focused author runtime passed 5/5; strict API consumer passed; unchanged invoke/cleanup/env/getopts regressions passed 280/280; unchanged core and owned-output regressions passed 39/39. The installed package tarball contains 834 files and hashes to `87c200daf413d9f1ab835b4d1738a1a93946fd3e350427b01accde4e0b23b1af`. The moved consumer resolved only `consumer/node_modules/virtual-bash/dist/index.js`, passed strict public declarations, observed cleanup before settlement, and retained the exact cancellation reason.

`RUNS.json` preserves baseline failures, both implementation regressions, reconstruction inventory failures, their versioned corrections, final commands, exit statuses, and scoped omissions. The independent Stage2 suite, frozen mutants, whole gate, SafeJS/private-engine probes, network, and deployed-provider checks were not run.
