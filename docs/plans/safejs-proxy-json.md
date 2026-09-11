# JSON serialization of Proxies

## Reproduced gaps

Eleven native-comparison tests failed before the repair: wrapped objects and
arrays serialized as empty objects, wrapped replacer arrays were ignored, cycles
were hidden, enumeration traps were skipped, and callable Proxy hooks bypassed
runtime dispatch.

## Repair

- Use guest array identity for values and non-callable replacers.
- Read and coerce array length through guest operations, once before iteration.
- Snapshot enumerable string keys using Proxy ownKeys and descriptor operations;
  retain that list before reading values. Explicit replacer lists skip enumeration.
- Invoke replacers and toJSON through the shared runtime dispatcher.
- Keep traversal budgeted and retain intermediate key lists and length objects.

## Evidence

The initial JSON selection passed 213 tests across ten files. After adding length
coercion, descriptor mutation, symbol exclusion, invariant, and revocation cases,
the expanded Proxy/console/BigInt/date/generator selection passed 133 tests across
five files. The final Proxy file contains 24 native-comparison cases. Package
TypeScript and scoped ESLint passed. These working-tree checks are focused
evidence, not a complete JavaScript conformance or integrated package gate.

Host import/export boundaries and other identity consumers remain separate audit
work. README updated; release hold remains in effect.
