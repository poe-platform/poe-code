# Markdown reader MCP QA

Execute these steps as an agent. Record command output and protocol responses in this plan; do not turn this flow into a QA script.

1. Build the selected `@poe-code/markdown-reader` workspace closure with the maintained build route.
2. Start `npm run dev -- plan markdown-reader-mcp` from the repository root with stdin open. Keep npm startup output separate from server JSON-RPC stdout when evaluating framing.
3. Send `server/discover` with request ID 1 and `_meta` containing `io.modelcontextprotocol/protocolVersion: 2026-07-28` and `io.modelcontextprotocol/clientCapabilities: {}`. Verify a valid discovery response, server identity and tools capability. Do not send legacy initialize on this connection.
4. Send `tools/list` with request ID 2 and the same metadata. Verify exactly `read` and `read_section`, following the current standalone command contract. Inspect input schemas and output descriptors.
5. Send `tools/call` with request ID 3, the same metadata, name `read`, and arguments `{ "file": "packages/markdown-reader/src/testing/fixtures/with-frontmatter.md" }`. Verify complete result type, matching server identity, structured frontmatter and TOC, and no tool error.
6. Close stdin and confirm clean process exit. Repeat on a fresh connection using legacy initialize `2025-11-25`, initialized notification, list and call. Verify legacy compatibility without modern-only result fields.
7. Capture and inspect CLI help with `npm run screenshot-poe-code -- plan markdown-reader-mcp --help` if command presentation changes.

## Execution evidence

Selected workspace closure build passed. Root CLI startup failed before protocol execution: tsx CLI IPC socket creation is denied by the sandbox; direct source startup then reported a missing agent-code-review build artifact. These root CLI checks remain incomplete.

Direct package stdio entry `node --input-type=module -e 'import { runMarkdownReaderMcp } from "@poe-code/markdown-reader"; await runMarkdownReaderMcp();'` completed modern discovery and tool listing. The standalone group exposes exactly read and read_section, without the root CLI approval composition. Identity: markdown-reader 0.0.1. Supported versions include 2026-07-28 and the three legacy revisions.

The historical file docs/plans/markdown-reader.md has moved to docs/plans/archive/markdown-reader.md; the original read request correctly returned -32602 file-not-found. Reading packages/markdown-reader/src/testing/fixtures/with-frontmatter.md succeeded with complete result type, matching identity, structured frontmatter and sections, and matching JSON text. This exposed a schema-fidelity defect: section number is returned as null but advertised as type string with the nonstandard nullable keyword. Fix and repeat validation against standard JSON Schema.

After rebuilding the corrected nullable descriptors, modern tools/list advertises section number as type [string, null]. Modern read succeeds with complete result type and matching identity; a fresh legacy initialized connection also reads successfully with structured object and text content, without modern resultType or identity metadata. Both connections exit zero on stdin EOF. Independent Ajv 2020 strict validation accepts null/string and rejects number for the generated nullable string property. The maintained Markdown-reader package suite passes 53 tests with 90.47% line coverage, exceeding its 90% gate.

Final built root CLI QA now succeeds through `node dist/bin.cjs plan markdown-reader-mcp` with explicit modern 2026-07-28 and legacy 2025-03-26 clients. Both list exactly read/read_section, read the maintained frontmatter fixture successfully, and exit zero after stdin EOF. Evidence: /tmp/mcp-final-root-markdown-composition-qa.log. The previous approval-tool expectation was stale: the current command calls the standalone package entry without approval composition. A slow-start discovery deadline regression exposed by this QA was fixed separately with a fast fake-timer test.
