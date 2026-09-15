# Native SDK optional undefined parity

Three failing SDK regressions reproduced whole-native schemas rejecting optional undefined values, including nested optional values and fields with defaults. Ordinary SDK schema validation treats optional undefined as omission.

Before strict JSON validation, omit only declared optional own data properties whose values are undefined. Preserve descriptors/prototypes and do not invoke accessors or serialization hooks. Bound schema-guided traversal; leave required/unknown/array undefined invalid. Then use the existing key normalization/default handling and native compiler validation.

Verify omission/default parity, unknown/required/array rejection, hook non-execution and existing nonplain SDK/MCP coverage. Keep JSON value validation itself strict.
