# PPTX media public model

Implement the documented returned interfaces using the format package and shared insertion engines. Own `slide-model.ts`, `presentation-model.ts`, the narrowly scoped crop policy in `image-formatting.ts`, and original media public model/insertion tests. Preserve all other changes. Root owns public exports, CLI/schema integration and commits.

Completed TDD sequence: first establish missing Picture.image, Movie and OLE-format behavior; implement live reads; exercise async shared insertion and save/reopen; add failing group-owner, null-poster, foreign-namespace, signed-crop and caller-owned poster mutation cases; implement the corresponding domain behavior. All fixture writes use memfs.

Agent QA procedure:

1. Run the focused public model/insertion tests plus existing slide, presentation and image-formatting suites.
2. Run package type checks and lint, then maintained package checks at integration.
3. Inspect that byte resources are copied, paths require explicit capabilities, movies never execute, and foreign namespaces cannot produce a Movie handle.
4. Verify group-owned inserted shapes retain group placement and package relationships after save/reopen.
5. Record results in `docs/pptx/media-public-model-evidence.md`; root commits only owned files and plan updates. Do not push.
