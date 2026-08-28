# Required Core Integration

This component uses only the committed core v1 methods. It is not a standalone CLI and creates no GO. Entry points are `type-worker.mjs#runWorker` and `loaded-worker.mjs#runWorker`. The coordinator owns build, spawning, clocks, candidate loading, lifecycle and actual exit/reap aggregation. No `build-worker.mjs` is supplied by this TYPE/LOADED assignment.

## Binding checklist

- Bind complete component source/data through `SOURCE-PRESEAL.json` and final seal, including fresh modes, added-entry checks and exact parents. `INPUT-PRESEAL.json` is the immutable earlier21-file protocol/data seal, not standalone authority.
- `readBoundJson('typePlan')` returns exactly TYPE-PLAN; `readBoundJson('mutantPlan')` returns exactly MUTANT-PLAN. `readBoundJson('runtimeJobs')` returns the authenticated `{jobs:[...]}` frozen149 object. The worker compares its selected whole witness object to this projection, not just the witness ID.
- Tool manifest and result provenance use `RESULT-SCHEMA.json`. Tree content digests identify historical tool profiles; core must separately admit the actual copied strict file/path/mode trees. The worker cannot derive a fresh tool admission from those digest strings alone.
- Core `runTool` derives executable and argv, with explicit scratch cwd. It must enroll the two exact scratch files after the acknowledged `generated-type-inputs` note, verify all transitive declaration/tool resolution and reject ambient fallback. It returns raw streams/status/reap and parent times before worker classification. No compiler is spawned by a peer.
- Before admitting a mutant materialization/import, core must authenticate and validate its existing same-profile earlier149 pristine witness capture. `loaded.pristineWitness` exposes that exact capture to the worker for repeated data/projection assertions, never repeated command execution. There is no new baseline process or extra slot. Absent/failed prerequisite must prevent control admission; peer reassertion is additional evidence, not permission to postpone that gate.
- `materializePackage` returns full `{files,directories}` manifest, absolute root and entry, profile and variantId; it owns physical copying and B rename, cumulative guards and purpose-limited variant authorization. Pending-shadow has two successive stage hashes. Source-built transformation preimages must match the pinned compiled package bytes; no fuzzy replacement.
- Core capture must normalize raw completion facts and provide actual resolution/parent/entry/factory/invocation evidence exactly as RESULT-SCHEMA. Core authenticates raw capture/result equality and all referenced artifacts. Worker load records are candidate regular files only; candidate builtins and harness entries remain separately core-admitted. Host files outside controlroot are not silently accepted as candidate imports.
- The complete870 maps are local data; do not serialize them through262144-byte IPC. Core may materialize/guard inside the outer worker capability and transport compact descriptors, but must present the committed API result object locally without weakening full-map comparison. This is a core transport implementation constraint, not a new worker CLI or method.

## Matrix

TYPE has three outer slots: source6/540000ms, moved6/540000ms, conditional public5/480000ms. Direct tools each request60000ms inside those immutable caps; unused time cannot reset any deadline. Current public slot returns five UNRUN_PUBLIC_EXPORT_GAP classifications and launches no compiler. No root import is faked. A future public map needs separately sealed authorization and a successor plan, not mutable configuration.

LOADED has five slots/profile, each90000ms: one pristine UTF22 positive, retained-view UTF22, quoted-DEL UTF02, quoted-DEL UTF03, pending-shadow ALS04. Stable legacy labels are retained; actual UTF02 is single quoted and UTF03 double quoted. Exactly10 future witness invocations, no baseline replay, three transformations, four mutant witnesses. Source-built and physically moved are the only profiles. Installed-unmoved is only origin/admission.

Outer process exit, signal, timeout, overflow and known reap remain core evidence; any failure overrides returned PASS. These results are TYPE/control role facts only, never194 semantic passes or public-export admission. Old cohort outcomes and source4 allocation proof do not supply runtime success.

## Remaining review

This component requirement is not an attestation that the separately authored core already supplies these opaque object shapes. Root must route them to the core owner and different reviewer before compound sealing. Every dynamic check remains UNRUN. No compiler, authored module, loader, product, native oracle or harness control was executed in preparation. Static data parsing of the authenticated author tar is not package replay.
