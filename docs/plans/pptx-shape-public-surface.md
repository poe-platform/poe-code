# PPTX shape text public surface

Ownership: shape text members in `packages/pptx/src/shapes.ts`, original
`shape-public-surface.test.ts`, and `docs/pptx/shape-public-surface.md`.
The table delegate owns only the separate FillFormat section and drawing namespace
helper in the same source file. The coordinator owns TextFrame binding/paragraphs.

1. Reproduce missing stable text-frame identity, model text getter creation, and
   group-container text-frame capability with original in-memory XML tests.
2. Reuse the existing live TextFrame binding, cache its returned handle, and bind
   its parent to the owning shape. Route model text access through that frame.
3. Check destructive shape assignment against preserving frame properties and
   deterministic invalidation of removed paragraph handles.
4. Run focused tests and the maintained package lint/unit routes; record evidence.

Agent QA procedure: inspect original XML before/after readShape and
has_text_frame queries, then access model text and verify one body appears before
extension children. Exercise frame-to-shape and shape-to-frame changes and retained
paragraph handles. No native process, network, publisher assets or host I/O belongs
in runtime or test inputs. These object-only changes require no CLI screenshot.

Progress: initial three regressions failed before changes; fixed with the existing
binding. The additional original stale paragraph regression now passes with the
coordinator's shared TextFrame implementation. Focused final run: 46 tests passed.
