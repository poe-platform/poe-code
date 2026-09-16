# Selected model content and guarded extent edits

Task: `adapt-upstream-tables-bdd` only. Later tasks remain pending. No README edits, push or release.

Original failing regressions covered inactive drawing branches, URI-based drawing types, selected settings and schema ordering. Selected outer/inner extents use active projection. Empty lexical extents reject. Writes inside alternative content remain explicit unsupported edits: the preservation guard rejects atomically and original bytes remain unchanged.

Original fast tests: `packages/docx/src/model-active-content.test.ts`. Retained failing and passing evidence: `docs/docx/model-active-content-evidence-20260915/`. Maintained checks are recorded by the aggregate task receipt. All mutations use original in-memory assets; no downloaded binary is a canonical dependency.

## QA procedure and status

Run the focused tests, maintained workspace lint/unit/build, and the real safe-bash model workflows. Capture and inspect changed command output. For page appearance and raster placement, render original generated documents, inspect screenshots and compare requested dimensions and story placement. Renderer QA is not run: no supported renderer is available in this session; Pages automation approval was denied. A passing XML/SDK test does not establish pagination or rendered fidelity.
