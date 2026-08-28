# FC-F02 / FC-F03 Source Correction

Static-only additive overlay of the frozen b1 composition. No execution GO.

- `overlay/core/capture-budget-v3.mjs` supplies shared charging and protected
  terminal reservations inside the existing per-job 32MiB cap.
- `overlay/core/owned-process.mjs` reserves and charges process metadata and raw
  prefixes, retains overflow failures and keeps timeout sticky.
- `overlay/core/phase-capture.mjs` checks the outgoing deadline before transition,
  including a post-append check, and preserves first-late timing and error identity.
- `overlay/core/supervisor.mjs` charges all per-job parent publications and checks
  the complete actual evidence total after final writes.

ASSEMBLY-OVERLAY.json binds preimages, postimages and source-to-target paths. This
is not a composed recipe: root must combine it with the separately owned FC-F01
overlay. No worker-api, tool-request helper, old build worker, product or parent
composition is edited. All dynamic witnesses remain UNRUN.

See SPECIFICATION.md for the contract, EVIDENCE-ROLES.json for exact accounting
classification, DEFERRED-WITNESSES.json for future controls and STATIC-CHECKS.json
for syntax/data checks only. INPUTS.json preserves the initial preparation shell
error; no failed execution is rerun or rescored.
