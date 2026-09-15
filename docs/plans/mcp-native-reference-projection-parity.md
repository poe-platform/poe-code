# Native reference projection parity

The compiler/converter comparison reproduced two valid schema failures: local $anchor references and relative references to embedded $id resources. Boolean compositions and draft-seven/modern tuple validation already passed.

Keep generic JSON projections for references the lightweight projection resolver cannot locate, and delegate resolution and invalid-reference diagnostics to the shared native compiler. Preserve the original schema document and exact input/output validation. Expand public schema-node types for Boolean compositions and tuple items.

Verify the parity matrix, maintained converter tests (including unavailable refs and prototype traversal), native conversion, type checking and proxy integration after rebuilding. Reference projections without a directly resolved primitive use JSON input in CLI; the native schema remains authoritative.

A further failing SDK case reproduced flattened oneOf branch defaults being applied to a different selected branch, causing valid input rejection. Keep unconditional property projections authoritative, and suppress automatic defaults on fields introduced solely by conditional branches. The original native document still validates all branch assertions. Validate both branch selections and retained unconditional default behavior.

The corrected explicit-scope CLI/MCP parity fixture reproduced CLI rejecting the first valid discriminator branch because its enum projection came from the last branch. MCP already accepted both explicit-scope branches. Merge common discriminator enum choices across root branches, and use unconstrained JSON projections for conditional-only fields where branch assertions cannot be represented safely. Preserve native schema assertions and suppress conditional defaults. Validate both CLI/MCP branch selections.
