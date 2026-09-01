# Preserve browser modules through the production build

## Problem

The browser engine plugin returned a fully bundled engine to Vite. Even after
removing the broad crypto polyfill, that opaque input produced a 1.30 MB session
chunk and the production build's large-chunk warning. Raising the warning limit
would hide the issue without improving the build.

## Improvement

Keep the engine's ESM graph visible to Vite. Compile only the two self-contained
worker bodies ahead of time, and expose the kernel, filesystem and worker sources
through small virtual modules. Share the existing exact-file AST adapters and
explicit browser capability policy between the standalone test build and Vite.
Inject platform globals per module without bundling their dependencies early.

Use explicit chunks for the platform, filesystem, workers, shell, structured
commands, text programs and remaining commands. Preserve the pinned engine,
worker cleanup, root-state instrumentation, buffer limits, licensing and watch
inputs. Do not change the warning threshold or suppress build diagnostics.

## Validation

- TDD: the Vite plugin's small-entry assertion fails against the old monolithic
  implementation and passes with the module graph.
- All 148 playground tests in six files pass; the playground typecheck passes.
- Production build processes 237 modules without warnings. Its largest chunk is
  408.16 kB, below the existing 500 kB warning threshold; the session is 12.80 kB.
- Real Chrome QA verifies all six checksum algorithms, gzip roundtrip, tar
  listing, basic and extended grep workers, pipelines, jq, timers and persisted
  working directory across commands. Console: zero warnings and zero errors.
- Screenshot inspected: `output/playwright/browser-module-chunks.png`.

No test isolation, concurrency, discovery or release ordering changes.
