# Standard schema interoperability

## Outcome

Toolcraft schema builders implement Standard Schema v1 and Standard JSON Schema
v1. Tiny MCP accepts these schemas directly alongside raw JSON Schema, including
caller-owned Zod 4.5.4 schemas, without a Zod runtime or peer dependency.

## Work

1. Add conformance and compatibility tests before implementing schema methods.
2. Preserve descriptor serialization and existing `Static`/`validate` behavior;
   expose accurate standard input/output inference and default-aware conversion.
3. Update shared MCP registration, parsing, output handling and HTTP types.
   Validate async refinements, transforms, defaults, discovery and errors.
4. Verify actual Zod 4.5.4 interoperability and isolated package declarations.
5. Run maintained scope checks and broader consumer checks, update user docs,
   commit atomic improvements to main, and verify GitHub publication and npm.

## Delivery constraints

No Zod dependency or imports in published packages. No copying executable schema
objects into protocol descriptors. Wire schemas/results remain JSON. Existing raw
JSON Schema validation and protocol-specific output behavior stay supported.
Releases run in GitHub Actions; local commits, remote delivery and successful
publication are tracked separately.
