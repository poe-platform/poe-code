# MCP public metadata type parity

The in-memory TypeScript consumer audit reproduced 14 diagnostics for valid protocol metadata: missing Icon, ContentAnnotations and ToolExecution exports; titles, icons, annotations and metadata on resources/prompts/tools/content; and metadata on resource contents.

Derive client declarations from the shared protocol owner, retaining the client's generic JSON Schema containers. Resource links inherit Resource. Add missing prompt argument titles and content/resource metadata to server declarations and content helpers. Preserve a maintained compile contract covering the exported surface.

Validate shared server and client compilation after the maintained dependency build; run protocol result and content regression coverage.

A second maintained consumer contract reproduced nine missing interaction fields: Implementation title/description/website/icons; root, sampling, tool-use/result and elicitation metadata; completion context; URL elicitation IDs. Share Implementation with the server owner and add the normative interaction fields. The complete client source/compile-contract program passes with zero diagnostics using owner source resolution.

The rebuilt wide consumer/schema gate passed 15,172 tests across 418 files. Protocol/OAuth coverage passed 2,269 tests across 105 files. These are functional checkpoints; the latest type-only additions still require rebuilt declaration/package verification.

Two unused expect-error diagnostics reproduced sampling declarations admitting embedded resources and direct resource links that the official sampling content union excludes. Narrow SamplingContent to text/image/audio/tool-use/tool-result while retaining rich resource blocks inside tool results. Verify the maintained negative compile contract and existing sampling runtime tests.
