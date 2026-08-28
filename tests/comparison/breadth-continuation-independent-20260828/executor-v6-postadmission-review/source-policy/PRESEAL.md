# Independent SOURCE/DATA review preseal — 2026-08-28

Owner: delegated independent SOURCE/DATA reviewer only. All new output is confined
to this directory. Product, diagnosis, prior evidence and other reviewers' work
are read-only. This is not a policy implementation or admission authorization.

## Checks fixed before execution

1. Authenticate all four diagnosis files against their exact Git blobs at
   `096c204c38fd7f1b6c096b9cb09e0ea877737fec`. Authenticate the admission evidence
   manifest and handoff against `becd1647a1572995750585b5c60d2be7d5fb77d4`.
   Use the immutable manifest's metadata to authenticate existing child-003
   config/receipt bytes; do not open or extract an archive.
2. Require the comparator receipt to contain exactly 21 `nextLoad` observations,
   with exact config/diagnosis path, size, mode and SHA256 agreement. Read only
   those already-materialized source paths, never instruction members. Reject
   symlinks/non-files and paths outside the existing comparator view. Hash each
   source before and after analysis. This is not whole-tree or append-proof
   authentication and does not certify deferred chunks.
3. Require main bundle SHA256
   `70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c`
   and fallback chunk SHA256
   `fae9347ddabceda17cfed0562a36d8dd570134e42a0d631122a6f85d7c6975f0`.
   Require exactly one `getBuiltinModule` token among the 21 sources, in the
   main bundle at UTF-8 byte 503554, line 808 (zero-based bytes, one-based lines).
4. Parse source as DATA using the existing TypeScript compiler only. Never
   import/evaluate comparator or product source, invoke a worker, compile emitted
   code, or execute the diagnosis script. Require no parser diagnostics. Resolve
   the `Mf` binding independently across the complete main-bundle AST: expected
   three occurrences, declaration and two writes, no read/export/shadow binding.
   Inspect the full enclosing try/catch and its `e`/`t` bindings, exact call
   receivers, arguments, optional chains, fallback and caught-error effects.
   Record bounded source excerpts and byte/line ranges; record mismatches rather
   than changing these expectations to make them pass.
5. Authenticate existing V6 worker/loader and its offline/asset guards against
   their Git blobs at the admission commit before reviewing them as text. Record
   their hashes and precise locations. Review import/factory/cleanup boundaries,
   loader identity checks and capability exclusions without claiming runtime
   isolation or raw Module/CJS certification.

## Boundaries and interpretation fixed before execution

No engine imports/execution, denied builtin retries, native semantic oracle,
installs, network, execution staging, timing, XAN/private access, instruction
archive reads/materialization, alternate-entry bypass, or policy implementation.
Git is used for immutable metadata/blob authentication and explicit owned commits,
not as a semantic oracle. Existing TypeScript is analysis tooling, not an engine.
Report and evidence will each remain below 262144 bytes; source excerpts are
bounded, not a full comparator dump. Preseal and checker are committed before
running the checker; output creation uses an exclusive write.

Preserve actual V6 `UNSAFE_STOP` 3/14, target installed/moved 211 loads each,
comparator 21 loads and exit 1 despite export/factory observations, zero C11 and
semantic calls, consumed grant `5ac29fef`, all recorded closures, all earlier
failures and W07 UNQUALIFIED/UNCREDITED. Keep 359581 observed stdout bytes,
65536 retained and 294045 irrecoverable; RESULT 531954 and four other oversized
artifacts remain failures. Reporting-component repair is outside this review.

The recommendation may approve only a conditional source-level design or hold.
It cannot authorize a new real admission or turn static checks into runtime proof.
