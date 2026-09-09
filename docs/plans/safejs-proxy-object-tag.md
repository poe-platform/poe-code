# Object tags for non-callable Proxy carriers

Seven tests failed on e1e8abde4 (42002). Object.prototype.toString skipped Proxy
tag reads and revocation checks, and did not recognize wrapped arrays.

Use the budgeted array-identity operation first, which also rejects revoked
targets, then read Symbol.toStringTag through guest get with the original receiver.
A string overrides the fallback; non-string tags preserve Array/Object identity.
Do not unwrap other target brands (a Proxy around a Date is not a Date).

The first implementation passed 28 runtime tests but failed TypeScript because
the shared read helper's value-or-Promise return was treated as always a Promise
(62007). After correcting that integration mistake, 44 tests across five files,
TypeScript and scoped lint passed (38480). Callable Proxy identity and its Function tag remain tied
to the unimplemented callable-carrier work. Ordinary objects with Proxy ancestors
also need separate tag-read validation. Public construction and snapshots remain
incomplete; this is not complete object-tag conformance.
