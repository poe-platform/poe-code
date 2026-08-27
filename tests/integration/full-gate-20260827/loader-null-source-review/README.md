# Four frozen loader failures: independent diagnosis

## Root cause and requested ownership

**All four are reproducible Node22.22.2 synchronous/asynchronous loader-hook
interoperability failures, not a demonstrated virtual-bash product bug, timeout
or concurrency flake. No repair has been applied.** The common dependency is
the runtime `import ts from "typescript"`, not merely that the entrypoint is TS.

The actual failing URL is the frozen tool
`node_modules/typescript/lib/typescript.js` (TypeScript5.9.3, SHA256
`3ae902c92cc44dace175c0e69e13a4b0899f6983c6121d76b9ab8dd5795e7675`).
Tracing after the asynchronous chain observes `format:"commonjs",source:null`
for **each** of the four entrypoints. Node validates that downstream result
inside the `next(url, context)` call at the external guard's line40 and throws
before the guard receives a result. It is not the guard's later critical-source
assertion, a guest/SafeJS return value, or a null TS file on disk.

**Minimal repair decision for ROOT/Curie, not a source patch in this review:**

1. Prefer a separately authenticated supported runtime profile with the upstream
   interop fix. Official Node22.22.3 includes backport `2e91b28aaf` / PR59929;
   that version is not installed here and was **not executed**. Installed
   Node24.11.1 contains the same fix and passes the bounded bootstrap controls
   below with the unchanged gate guard and unchanged tools. This is evidence
   for an explicit runtime-profile change, not authority to silently change
   the frozen8670/Node22.22.2 result or select a new whole-gate runtime.
2. If root requires retaining Node22.22.2, request a narrow **external gate
   harness** adaptation: the successor import-guard module/registration and,
   if necessary, its `run.mjs` preload staging/environment. Curie retains those
   paths. A `result.source ??= ...` after the existing synchronous `next()` is
   unreachable for this failure and is not a fix. Any adapter must preserve
   source/root/critical-hash/fallback controls and CommonJS behavior; do not
   blindly disable the guard, tsx, or all CommonJS authentication.

No product `src/**`, original four tests, package engines/dependencies, native
profile assets, root configuration or existing gate files need editing on the
evidence currently established. A selected runtime/workaround requires a
different reviewer, retained guard mutants, actual affected test-body replay
with qualified prerequisites, and explicit root authorization before another
whole suite. A loader fix does not settle the other eight original failures.

## Frozen inputs and original evidence

- Product8670ebe8f0d39966c2de2638780437398e5f8490, original gate reportd98b8321.
- Original command: `npm test -- --test-concurrency=2`; its declared evaluator
  spawns `node --import tsx --test --test-concurrency=2` with560 discovered files.
- Phase environment adds `NODE_OPTIONS=--import=file:///.../harness/import-guard.mjs`.
  Full original environment is retained in each `RESULT.json`; rebased paths
  stay in the owned isolated snapshot. LC_ALL/LANG=C, TZ=UTC and
  TSX_DISABLE_CACHE=1 are unchanged.
- Node22.22.2 Darwin arm64, binary SHA256
  `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
- Guard SHA256 `af4608b333f6b2dc4384fb28d3866a134ba3efc0a120d63a9adeee79f0f21114`.
- All314 copied development-tool files match the original gate receipts;
  tsx4.23.12, TypeScript5.9.3, esbuild0.28.2. Regular copies only, no install.
- All529 selected committed source/test/configuration inputs are Git-blob
  authenticated and byte-unchanged afterward. Source is a selective Git archive,
  not a live checkout overlay or a reused dist. This is a diagnostic subset,
  not a newly qualified full-product archive.
- Original raw archive8a2beed3…648 is authenticated against the committed
  capture. `ORIGINAL-FOUR.json` retains the four original stack excerpts and
  line numbers; the original806-file capture and17454pass/12fail stay untouched.

The four paths, unchanged, are:

- `tests/commands/metadata-stress/mktemp-controls.test.ts`
- `tests/commands/metadata-stress/permission-profile-independent/review.test.ts`
- `tests/commands/safejs/local-safejs.test.ts`
- `tests/integrations/safejs/local-safejs.test.ts`

`f6e07510` removes only a duplicate tar staging call from `prerequisites.mjs`;
its hash60ae62f6…2db equals the actual gate receipt. It does not alter the
import guard, Node, tsx or TypeScript. Our reproductions never run that staging
function, yet fail identically. Earlier6fce94f8 staging failures/nine author
controls are distinct; no causal attribution to staging is supported.

## Actual bounded executions

Final `attempt-3`: August27,2026 15:01:15–15:01:23 UTC,19 Node children.

| Diagnostic | Observation |
| --- | --- |
| Four files individually, concurrency1 | 4/4 original null-source failures reproduced before test bodies. |
| Same four together, concurrency2 | Four matching file-bootstrap failures, not a scheduling-only defect. |
| Each file with an additional passive async trace | 4/4 traces identify typescript/lib/typescript.js, commonjs/null. |
| Minimal ESM `import ts from 'typescript'`, original guard+tsx | Same null-source failure; no virtual-bash source or private engine required. |
| Diagnostic ablations | tsx without guard loads TypeScript; guard without tsx loads it. These are causal controls, **not proposed gate modes**. |
| Plain `.cjs`, pass-through async hook plus original sync guard, no tsx | Same validation boundary rejects **undefined**, not null. This independently reduces the defect to Node hook interop. |
| Async trace registered before tsx | Fails still earlier on esbuild/lib/main.js commonjs/null during preload; it is not a successful below-tsx TypeScript trace. |
| Installed Node24.11.1, same four files/tools/guard | 4/4 bootstrap successes with guard retained. Plain-CJS async+sync control also succeeds. |

**Bootstrap only:** `--test-name-pattern=^LOADER_REVIEW_NO_TEST_BODY$` prevents
all test-body execution, native probes and SafeJS engine calls. Node24 reports
one passing file wrapper per selected file; those four wrapper passes are not
feature/workflow assertions, nor acceptance of unavailable-engine cases. No
private tree was read/copied/modified, no engine installed/built, no full suite
or product build ran. `SAFEJS_LOCAL_ROOT` is rebased to an unused owned path,
not the private checkout. `METADATA_HELPER_COPY` points to the exact historical
3a1025f5 fixture bytes solely to satisfy that test's top-level read after a
successful bootstrap; it is not a changed assertion or live Git fallback.

Alternate runtime binary SHA256:
`4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
It was already installed; no download or new dependency. Runtime version is
the deliberate comparison variable, not a purported same-runtime fix.

All38 Node children across the three retained attempts settled without timeout
or signal; each owned snapshot/tar/tool tree was removed. Attempts1/2 already
reproduce all four original failures. Their **review-harness** failures are
preserved: attempt1 incorrectly expected the plain `.cjs` reduction to say
`null` rather than `undefined`; attempt2 expected a TypeScript trace before
tsx registration, but the earlier esbuild CommonJS load fails first. Attempt3
records these specific distinctions, without changing any original test or
four-case expected failure. No diagnostic failure was hidden or called product
acceptance.

## Node primary-source explanation

Captured directly from the executing22.22.2 binary in `attempt-3/node22-*.js.txt`:

- `customization_hooks`, lines269–285: validateLoad rejects nullish non-builtin
  source. Lines179–195 show validation of the downstream step before returning
  to the caller's hook.
- `esm/loader`, lines824–851: the sync chain uses the asynchronous-loader thread
  as its default step when asynchronous customizations exist.
- `esm/load`, lines58–107: CommonJS source can be undefined when its format was
  already known, or reset to null after format detection for CJS compatibility.

Primary upstream references (read-only; no downloaded code was executed):

- https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/internal/modules/customization_hooks.js
- https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/internal/modules/esm/loader.js
- https://raw.githubusercontent.com/nodejs/node/v22.22.2/lib/internal/modules/esm/load.js
- https://github.com/nodejs/node/issues/57327
- https://github.com/nodejs/node/commit/2e91b28aaf
- https://nodejs.org/en/blog/release/v22.22.3 (May13,2026, includes PR59929)
- https://nodejs.org/en/blog/release/v24.11.1 (includes PR59929)

## Reproduction

```sh
node tests/integration/full-gate-20260827/loader-null-source-review/diagnose.mjs /tmp/NEW-EXCLUSIVE-LOADER-REVIEW
node tests/integration/full-gate-20260827/loader-null-source-review/verify.mjs
```

The first repeats only the bounded diagnostic cohort and requires the recorded
tool bytes and already-installed24.11.1. It never launches the whole gate or
test bodies. The second checks the sealed captures without running product code.
