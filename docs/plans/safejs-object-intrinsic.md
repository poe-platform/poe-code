# Sandbox-owned Object inspection

Issue: #544.

- Provide a per-execution Object constructor and mutable ordinary Object.prototype, never native prototype access.
- Support generic toString, valueOf, hasOwnProperty, propertyIsEnumerable and isPrototypeOf with branded type inspection.
- Resolve ordinary default and explicit null/custom prototypes consistently in lookup, construction, enumeration and reflection.
- Keep constructor implementation fields private, intrinsic methods non-enumerable and host callables read-only.
- Retain prototype-owned values under existing budgets and release intrinsic roots when an execution or realm closes.
- Preserve existing plain-data copy and replay boundaries; explicitly reject unsupported prototype-bearing graph encodings rather than silently flattening them.
- Test native-comparison tags, the reported cached jQuery inspection path, invalid receivers, native pollution, isolation, mutation and budgets. Verify published Node/Bun consumers before closing.
- Primitive boxing and full Array/Function/exotic intrinsic prototype graphs remain outside this change.
