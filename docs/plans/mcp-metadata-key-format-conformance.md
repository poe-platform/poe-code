# MCP metadata key and format conformance

Official 2026-07-28 MetaObject documentation requires optional label prefixes and ASCII name syntax, including permitted empty names. The generated official JSON Schema does not encode this grammar. Fourteen failing checks reproduced invalid root/nested metadata keys, invalid icon URIs, and missing explicitly registered format assertions.

Add generic explicitly registered synchronous string format validators to the shared JSON Schema compiler. Snapshot own registrations; leave unknown formats as annotations. Enrich only the runtime MCP schema's metadata definitions with a custom property-name format, preserving the official source document. Register URI/base64 assertions for protocol-defined slots. Do not inspect arbitrary structuredContent or extra application fields as protocol metadata.

Use the same metadata syntax owner for request admission and outbound request/notification preflight. Preserve unknown reserved-prefix values; only validate key grammar and JSON safety.

Validate core/client/protocol results and the JSON Schema conformance matrix; rebuild owner/client consumers, run maintained repository checks, and recheck package artifacts. Public CompileJsonSchemaOptions.formats documentation addition is pending the previously unanswered README permission request; no README additions are authorized.

Two failing direct protocol-selection cases exposed metadata accessors being invoked before admission. Read the own enumerable data descriptor before inspecting metadata, matching serialized JSON visibility. The client notification path likewise preflights JSON safety and reads serialized metadata descriptors without invoking getters.

Proposed README addition for approval: `compileJsonSchema(schema, { registry, formats })` accepts a map of format names to synchronous `(value: string) => boolean` validators. Registered formats assert string values (including property names and referenced schemas); unknown formats remain annotations. The compiler snapshots own registrations so later registry mutation does not change compiled validation.
