# Promise constructor and species Proxy reads

Four native comparisons failed before the repair. Await preparation skipped an
inherited Proxy constructor read, changing observable lookup order and swallowing
its error. Direct and inherited Proxy species reads also swallowed trap errors.

Stop the Promise property descriptor walk at a Proxy boundary and resume with
the shared guest read operation, preserving the original receiver and budget.
Ordinary own descriptors retain their existing behavior and terminate lookup.

Ten native comparisons cover constructor read order and errors, direct and
inherited species, actual custom subclass selection, trap receiver identity,
revocation, and own species shadowing of a revoked ancestor. The positive custom
species cases assert the resulting subclass, not only the settled value, so a
default-constructor fallback cannot produce a false pass.

A checkpoint case preserves a Proxy species constructor across await and checks
the restored result's subclass and value. Focused property-read and checkpoint
selection: 46 tests passed across 2 files.

The broader Promise/checkpoint selection passed 717 tests across 50 files.
Scoped ESLint and package TypeScript passed.
The host-Promise import-policy tests remain unresolved and excluded from this
focused selection. No full-package gate claimed.

README updated. No CLI presentation changes. Pushes and releases remain held.
