# Original ZIP reader validation

Concrete source evidence: `tests/fixtures/archive.ts` writes extraction version 20
to local and central stored-entry headers. The independent `tests/zip-reader.ts`
previously required exactly 10 for every stored entry, rejecting otherwise valid
original fixture bytes preserved by a no-op operation.

The assertion reader now admits stored extraction versions 10 and 20. Deflate
still requires 20, both headers must agree, and all existing method, size, CRC,
entry order and boundary assertions remain. This is test infrastructure only.

Original `src/zip-reader.test.ts` uses one tiny original payload and checks both
accepted versions and header mismatch rejection. The version-20 case failed
before the helper edit. All three tests now pass. A focused run with metadata
schema and sanitization checks passed 22 tests across four files.

No external fixture, network, native runtime, host I/O or filesystem test writes
were needed. This receipt makes no broader archive compatibility claim.
