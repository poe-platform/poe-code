# JSON defaults in MCP descriptors

Toolcraft supports opaque values such as callbacks in server-side defaults. These values cannot be advertised as JSON Schema defaults. A focused test reproduced DataCloneError during MCP server creation; three existing default tests showed the same failure.

Validate converted defaults as JSON and omit non-JSON defaults from wire descriptors. Retain canonical defaults for handler-side application and isolation. Apply the same rule to discriminator branch defaults.

Validation: 376 default-descriptor, isolation and applied-default checks pass. The focused test also verifies that handlers receive their callback default without invoking it and that the advertised schema omits the unsupported default.
