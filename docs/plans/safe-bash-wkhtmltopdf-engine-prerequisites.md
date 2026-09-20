# wkhtmltopdf engine prerequisite gates

Inspection date: 2026-09-18. Task: `engine-wkhtmltopdf`. Implementation remains incomplete; no renderer or compatibility gate has passed.

The command plan requires prerequisite acceptance before dependent integration (`safe-bash-wkhtmltopdf.md`, Execution). Its intended profile includes first-party HTML5, computed CSS, shaping, box layout and paged rendering. These prerequisites are not supplied by the current Pandoc/PDF conversion path.

## Current source evidence

| Requirement | Inspected source | Result |
| --- | --- | --- |
| Reusable first-party HTML5 tree builder | `packages/pandoc/src/html.ts:1` and `packages/pandoc/package.json` | Uses external `parse5`. Its `dropped` set removes `style`, `base`, `link` and other elements needed for browser document processing. This is a document AST reader, not the requested rendering DOM. |
| Computed CSS and box layout | `packages/pdf/src/model.ts:1` | Accepts preconstructed paragraph/image/table blocks in PDF points. No cascade, selector, inherited-style or CSS box contract is exposed. |
| Tables with row/column spans | `packages/pdf/src/model.ts:15` and `packages/pdf/src/index.ts:12` | Explicitly rectangular, unspanned tables. |
| First-party font/shaping and PDF rendering closure | `packages/pdf/src/index.ts:1`, `packages/pdf/src/serialization.ts:1`, `packages/pdf/src/png.ts:1`, `packages/pdf/package.json` | Runtime uses `pdf-lib`, `@pdf-lib/fontkit` and `pako`. Private workspace bundling does not remove these external runtime dependencies. |
| Pagination primitives | `packages/pdf/src/model.ts:5` and `packages/pdf/src/index.ts:173` | Existing paragraph break/keep and widow/orphan rules are useful prior work, but do not establish computed CSS pagination, positioned content or page furniture. Do not discard or duplicate this work. |
| Command workspace and export | Workspace package manifests and `packages/safe-bash/package.json` | No `safe-bash-command-wkhtmltopdf` workspace or `./commands/wkhtmltopdf` export exists. No private command/contracts engine workspace was found in the inspected manifests. |

Evidence was obtained by reading the listed sources, searching package source paths, and parsing workspace manifests and safe-bash exports. No native comparator was executed. Missing prerequisites are concrete source findings, not failed runtime compatibility tests.

## Required execution order

1. Establish reusable first-party HTML5/CSS/selector, font/shaping, image and box-layout owners with pure typed APIs, structured errors and explicit work/allocation limits. Retain the existing PDF primitives where their dependency closure can meet the requested artifact policy; do not import Pandoc wholesale or create a second simplified shared engine.
2. Pass original fast failing-then-passing tests for cascade/inheritance, units, inline/block flow, lists, supplied images, table spans, breaks, widows/orphans, positioning and page furniture. Flex and grid each require separate acceptance gates. Use memory VFS and mocked capabilities. Verify cancellation and admission before retained allocation.
3. Implement the command parser in `packages/safe-bash-command-wkhtmltopdf`, preserving the researched 122-switch admission/rejection matrix, scoped clones, ordered duplicate handlers, cover cleanup, byte encoding policy, binary32 settings and batch tokenizer. Test parser semantics independently from renderer qualification; parser completion does not satisfy the engine gate.
4. Integrate only after prerequisite gates pass. Follow `safe-bash-command-package-pattern.md`: private leaf contracts → shared engines/command → safe-bash; preserve runtime brands and constructor identity. Bundle implementations and declarations into the safe-bash artifact and verify an isolated packed consumer without private workspaces.
5. Verify CLI/SDK equivalence, VFS identity-aware resources, invocation cleanup, byte backpressure, bounded output staging, deadlines and cancellation. Keep dynamic execution and ambient network unavailable. Test logical numbering, physical pages and outline counters separately, plus bounded TOC convergence and explicit clock/locale inputs.

Pinned upstream findings remain source-derived. Patched-Qt binary qualification, native numeric/encoding controls and XSLT profile qualification remain separate from first-party unit acceptance. Do not label a static subset browser parity or mark the engine task complete from this inspection.

No product code, manifests, exports or existing planning files were changed by this inspection. No build, unit tests, screenshots, commits, pushes or releases were performed; this new prerequisite document is the only added file.
