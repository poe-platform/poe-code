# Original default style families

Task: `adapt-upstream-tables-bdd` only. Later tasks remain pending. No README edits, push or release.

The original factory and lazy missing-style-part path now provide paragraph, character and table defaults. An original default-style regression failed before implementation; existing creation tests remain unchanged. Original style names and assets replace external template defaults.

Original fast tests: `packages/docx/src/default-model-styles.test.ts`. Retained failing and passing evidence: `docs/docx/default-model-styles-evidence-20260915/`. Maintained checks are recorded by the aggregate task receipt. All mutations use original in-memory assets; no downloaded binary is a canonical dependency.

## QA procedure and status

Run the focused tests, maintained workspace lint/unit/build, and the real safe-bash model workflows. Capture and inspect changed command output. For page appearance and raster placement, render original generated documents, inspect screenshots and compare requested dimensions and story placement. Renderer QA is not run: no supported renderer is available in this session; Pages automation approval was denied. A passing XML/SDK test does not establish pagination or rendered fidelity.
