# Required build/core integration — no current GO

This component supplies the missing concrete build body, not a core implementation
attestation. It reads no unsealed core body. Existing TYPE/LOADED c0353685 remains
untouched and contains no duplicate build worker.

## Fresh assembly

Use exactly ASSEMBLY-MAP.json. Project the six code/data files from this new build
scope into a fresh `workers/` union. The entry is `workers/build-worker.mjs` and its
only relative imports are uniquely named build helpers. No old workers file or
global membership seal is edited. Root must validate each immutable component's
source membership separately and seal the complete fresh assembled membership.

## Named data and generated inputs

- `readBoundJson('buildPlan')` returns `workers/build-plan.json` exactly.
- `sourceManifest` returns the complete `{files,directories}` source map projected
  as `workers/build-source-manifest.json`; `packageManifest` returns the complete
  counterpart projected as `workers/build-package-manifest.json`.
- `toolManifest` is the four-entry fresh path object defined in BUILD-RESULT-SCHEMA.
  The build worker separately verifies every copied byte/mode/path against its
  sealed full tool trees. Fresh tools must use the declared layout, including the
  explicitly admitted node_modules subtree; no ambient modules or NODE_PATH.
- Source, tool, scratch and evidence roots are canonical, outside the workspace,
  mutually nonoverlapping. Source/tool and generated directories use0755; files
  use0644 except the pinned executables. Core must launch with an appropriate
  presealed umask0022; the worker never chmods or changes process umask.
- Acknowledged `generated-build-inputs` carries exact config path/hash/size/mode,
  fixed compiler request, expected invocation, sourceRoot and owned output roots.
  Core must enroll and freshly verify that config before runTool. Compare its
  actual bytes with the deterministic extends/outDir/typeRoots projection, not
  merely a self-announced digest. Source config originals remain unchanged.

## Tool return refinement — required, not currently proven

CORE-INTERFACE v1 specifies base runTool fields but omits actual argv/cwd/tool/time
provenance. This worker requires the same additional `provenance` shape already
published by TYPE/LOADED in c0353685. BUILD-RESULT-SCHEMA specifies it precisely;
the worker fails unsafe if absent or contradictory. No new API method is invented.
Core's future body/compound seal must demonstrate this result envelope before GO.

Parent derives the literal approved compiler profile; it must not execute arbitrary
caller argv. The 120000ms child cap, output8MiB combined, known-group reap and all
parent times stay inside the existing300000ms BUILD reservation. No worker-local
timer or extra post-build allowance exists. Remaining-budget admission is a core
UNRUN decision before dispatch; an admitted child timeout/nonzero cannot be waived.

The compiler returns first into a durable `compiler-return.json`; then lifecycle
capture is acknowledged and assertions begin. Parent raw streams already exist.
Core must preserve its actual argv/cwd/executable/TS identities, exact environment,
start/end/reap nanoseconds and overflow flag. It must not report expected values
as observed execution facts. Unknown reap is unsafe even if output contains PASS.

## Local artifacts and stage adoption

`writeJson`/`writeBytes` must publish locally through the existing capability with
the16MiB per-file and32MiB metadata bounds. Comparison/integrity maps can exceed
262144 bytes and tar bytes exceed an IPC message: do not JSON-transport full data
through that channel. Only compact artifact references and notes go through IPC.
This is the same transport constraint as the existing TYPE/LOADED component.

The generated config, raw outputs and package stay in retained worker scratch.
`generated-build-output` is a pending-result notification, not permission to load.
Core must retain and cumulatively guard all these paths, including partial outputs
on failure, rather than broadly excluding scratch. Successful `stageOutput` is
small: full manifests live in hashed evidence files with documented JSON pointers.
Core must reread/rehash them, check the exact candidate and expected package map,
regular full tree, entries, proof, packed artifact and final integrity, then require
outer zero exit/known reap before exposing A. Parent failure overrides worker PASS.

`sourceBuiltManifest` points to plain `{files,directories}`. Source/tool and raw
output snapshot artifacts wrap the map at `/manifest`; stageOutput includes those
pointers. Do not accidentally treat the wrapper as a package map. A's entry is the
new compiler-derived870 root, never the author package. B installs/materializes
the full package and physically moves it under the separately owned core recipe.

## Preserved limits

All actual compilation, worker invocation, packing, loader, runtime, types and
negative controls are UNRUN now. Old f7503dc is method/tool provenance only. Legacy
historical final-seal mode is not reused as an active-code mode; original DENY stays
historical. The old FAIL/CMD22/deadline-UNRUN and author9/26/19 remain unchanged.
Public exports stay absent and the five conditional public types stay UNRUN.
