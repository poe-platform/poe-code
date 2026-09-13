# Shared chart drawing completion

Owner: drawing-format delegation. Owned implementation: drawing-format.ts,
shapes.ts; original tests: drawing-chart-reuse.test.ts. No README or CLI edits.

1. Read root instructions, format/shared specifications and pinned API/test inventories.
2. Reproduce chart owner namespace rejection and missing inherited stop interfaces.
3. Reuse existing fill/color/line/shadow domain logic for both chart dialects.
4. Add owner-bound stop element and equality; retain collection equality behavior.
5. Run original fast drawing tests and maintained package lint; parent runs package tests.

Agent QA: inspect original in-memory chart-owner XML after gradient, line and
shadow edits. Check both dialects and preservation tests. No render/native/network
or disk-fixture workflow is needed for these nonvisual domain changes. Do not
claim whole chart integration from detached owner tests; chart delegation owns
that acceptance. Record results in docs/pptx/drawing-chart-reuse-evidence.md.

Final root verification: maintained `npm test --workspace=pptx` passed 6,292 tests in 236 files; `npm run lint --workspace=pptx` and `npm run build:workspaces -- --workspace=pptx` passed. No push or release.
