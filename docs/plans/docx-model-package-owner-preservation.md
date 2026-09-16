# Preserve unchanged document owners during package edits

Task: `adapt-upstream-tables-bdd` only. Later tasks remain pending. No README edits, push or release.

Two original in-memory regressions failed before the package stage compared owned part bytes. Inert relationship insertion preserves paragraph/run/body owners; a changed header detaches only its own owners. Comparison work and retained lookup storage are charged before publication.

Original fast tests: `packages/docx/src/model-package-owner-preservation.test.ts`. Retained failing and passing evidence: `docs/docx/model-package-owner-evidence-20260915/`. Maintained checks are recorded by the aggregate task receipt. All mutations use original in-memory assets; no downloaded binary is a canonical dependency.

## QA procedure and status

Run the focused tests, maintained workspace lint/unit/build, and the real safe-bash model workflows. Capture and inspect changed command output. For page appearance and raster placement, render original generated documents, inspect screenshots and compare requested dimensions and story placement. Renderer QA is not run: no supported renderer is available in this session; Pages automation approval was denied. A passing XML/SDK test does not establish pagination or rendered fidelity.
