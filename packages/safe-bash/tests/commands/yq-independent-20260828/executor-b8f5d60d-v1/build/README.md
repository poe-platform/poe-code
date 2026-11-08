# Concrete b8 build worker — static source seal only

`build-worker.mjs` exports `async runWorker(api)` for the sealed core v1 ABI. The
body requests one supervisor-owned compiler, checks all868 outputs, preserves434
raw maps with only declared logical-source relocation, creates a fresh870 package
from compiler output plus baseline README/package metadata, and performs exactly
one builtin USTAR/gzip serialization. It does not spawn, run Git, use timers or
import candidate code. Nothing in this component was invoked during preparation.

Source/profile: b8f5d60d /644460b9 /065f824d, selected271 /archive273 /package870
(846+24), with five source and17 expected output changes. All expected maps and
tool files are pinned from immutable data; no author output is copied as built.

ASSEMBLY-MAP.json maps six files into a **fresh** workers assembly without changing
the existing TYPE/LOADED global membership. BUILD-RESULT-SCHEMA.json and INTEGRATION.md
give exact named-data, parent provenance, config enrollment, large-local-artifact
and stage-adoption requirements. Detailed tool provenance is an explicit unresolved
core integration requirement, not an invented API or an asserted core capability.

Current evidence is input authentication, finite data/closure checks, source hashes
and syntax only. Compilation, byte reproduction, packing, all negative controls,
profile A/B semantics, types, loading and lifecycle remain UNRUN pending future
compound seals, independent review and RootGO. Static source is not build proof.

Build stays within300000ms, with one120000ms compiler inside it. The accepted global
336 slots/24165000ms and maximum18 compilers are unchanged; installed-unmoved is
admission only. P1 public caps/CARRY are unchanged. No global-green claim is made.
