# Diagram CLI inventory and preservation

Scope: original memfs integration cases in `packages/safe-bash/tests/commands/pptx/diagram-inventory.test.ts`. Root owns test inventory registration. No production adapter logic is required: `inspect` delegates to the SDK and exposes its inventory.

1. Build a tiny original two-slide archive in memory with shared data, colors, layout and style parts, a drawing fallback and its binary appearance dependency.
2. Assert exact independent records through both `readSelectionIndex` and `pptx inspect --slide 1 --json`: direct owners include both slides despite selection, dependency closure includes drawing and image, and semantic editing remains false.
3. Exercise absent drawing graph edges and a fallback-only package without inventing diagram data or semantic editing.
4. Run `text replace --all --output -`, independently decode archive members and compare every unrelated part byte. Verify source input remains unchanged.
5. Run the focused safe-bash maintained reporter after the PPTX public exports are rebuilt. Record red/green evidence here.

The F40 preservation requirement and shared office contracts define this scope. Upstream test/API inventories contain no diagram-specific behavioral cases; their broader gaps remain research accounting, not a claim of full API or test parity. Assets are authored locally in code, require no downloads and contain no derived material. Disposable corpus QA, screenshots and SDK import coverage belong to the parent assignment.

Red checkpoint: all three `inspect` variants failed because `data.inventory.diagrams` was absent. The independent preservation control passes after completing the original fixture's content-type declaration. The unrelated caption's shape name intentionally retains its original value while its text changes. A fifth case checks `capabilities --json` reports preservation for `inspect` and `slides.import` and explicitly disables semantic editing and automatic layout.

Focused command: `node packages/safe-bash/scripts/test-reporting.mjs --import tsx packages/safe-bash/tests/commands/pptx/diagram-inventory.test.ts`. Tests use public built `pptx` exports; rebuild the selected workspace before the green checkpoint.

Green checkpoint: all six cases pass through the maintained reporter against rebuilt public exports (588 ms process duration). The added `slides import` case imports into an existing matching resource graph to force name collisions, independently compares both copies of all five appearance parts and their image bytes, parses the rewritten data/drawing relationship targets, and checks both source and destination VFS inputs remain unchanged. Root coordinates the guarded lint check and registration test.

Root authorized a focused call through the unchanged exported lint guard API, following the procedure in `pptx-advanced-chart-cli.md`: bootstrap-check package/config bytes, reject bulk suppression, create the existing selection, begin its one-shot guard, verify all 25 boundary receipts, classify each exact owned subject and pass its single admitted read to `lintText`. The diagram test (13,117 bytes, SHA-256 `25491dafb94fce363f64b497e50fa627cb5b82dab98ebf3b72086f0d615f52a6`) and root-owned discovery test (220,172 bytes, SHA-256 `c98a69ae198381934e9136aadc94b2658cf1fe4809bd326146518606058c4745`) both have zero errors, warnings and messages. Guard: two subjects, 233,289 subject bytes, 2,010 opens and closes, `receiptsComplete: true`, `failed: false`, exit 0. This is literal-file lint evidence, not a full-root crawl or release gate.
