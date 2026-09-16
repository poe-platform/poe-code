# Deterministic PPTX ZIP writer

Scope: the `zip-writer` task only. The existing pipeline plan is unrelated dirty
work and is not edited or staged. Owned paths are the new package writer, its
original tests and independent ZIP assertion reader, this plan, and writer
research/usage receipts in `docs/pptx`. No safe-bash or root runtime changes are
needed, so the scoped safe-bash delegation rules do not apply to implementation.

## Design and limits

Keep the writer internal to `packages/pptx`, alongside the existing internal
package reader. Reuse the existing shared codec for local/central records,
descriptors, source ZIP64 admission and compression. Do not export an unfinished
Presentation model or introduce a CLI operation without its shared operation
schema. Full SDK/CLI integration remains a later task, not a passing claim here.

The caller supplies the complete final member list and an explicit `store` or
`auto` policy. New/changed entries use UTC 1980 timestamps and sorted exact names;
`auto` deflates only when smaller. An optional admitted source is fully verified,
including removed members. Entries with identical names and decoded bytes reuse
their compressed payload and retained metadata. Source descriptors are replaced
with complete classic headers. Unchanged payloads remain exact; edited container
bytes need not match. This low-level serialization always orders entries; an
eventual no-op editing operation can return its original bytes before calling it.

Output is staged as bounded bytes before any sink publication. Explicit byte and
archive ceilings apply; classic output rejects the 65,535 member sentinel and
32-bit size sentinels. This does not promise ZIP64 output, streaming output, OPC
graph validity, directory publication, source signatures or atomic remote writes.
Names here are relative ZIP member names; OPC URI conversion belongs to the next
identity task. No implicit host I/O, runtime processes or network is added.

## TDD and verification procedure

1. Add original byte fixtures and an independent classic-ZIP assertion reader.
   Verify local and central records, offsets, lengths, ordering and CRC using
   Node's zlib CRC and inflate routines, never the product reader. Add deliberately
   corrupt output controls. Use memfs for publication checks; no test disk files.
2. Run the maintained pptx workspace test task before implementation. Initial red:
   the new writer module does not exist; all 115 existing package tests pass.
3. Implement the writer, then add signed/unsigned stored/deflated descriptors,
   UTF-8 size limits, output ceilings and cancellation. The compressed-fit test
   reproduced a resource error for 2,048 decoded bytes under a 160-byte output
   limit. Separate bounded precompression admission from final output admission;
   the independently decoded result must still contain all 2,048 bytes.
4. Run `npm test --workspace=pptx`, `npm run lint --workspace=pptx`, and
   `npm run build:workspaces -- --workspace=pptx`. This is an explicitly selected
   package closure, not a root-only substitute for repository-wide testing.
5. Select disposable cached files from `docs/pptx/corpus-manifest.json`, authenticate
   their SHA-256 hashes, decode through the built codec, append one XML newline to
   the content-type stream, and serialize with source reuse. Write outputs only
   to an owned temporary directory. Open originals and outputs with the independent
   Python standard ZIP reader; verify every CRC, exact member sets and every
   unchanged payload. Compare retained compressed member bytes independently.
   The native reader is a QA oracle only, never a product dependency.
6. Record exact case mappings and visible pending graph/BDD/public API obligations
   in the research receipt. Review only owned changes and commit them on main
   with normal hooks, explicit paths and a Conventional Commit. Do not push.

## Verification results

The final maintained workspace test run passed 151 tests, including 36 original
writer cases; the writer suite took 271 ms. The selected workspace build closure
contains only `office-package` and `pptx`. Package lint includes production and
test TypeScript checks; the independent test helper also receives scoped ESLint.

Additional failing regressions exposed UTF-8 BOM stripping during name admission
and acceptance of unsafe source names when those entries were omitted. Both are
fixed and passing. The assertion reader's Buffer/Uint8Array comparison was also
corrected without changing expected byte values. The 32-bit sentinel controls
use synthetic size metadata without allocating multi-gigabyte arrays; no large
archive stress qualification is claimed.

Three hash-verified manifest files were edited only by adding a newline to their
content-type XML. Python 3.14.7 `zipfile` independently verified all 110 members,
CRCs, sorted output names and exact member sets. All 107 unchanged payloads and
their compressed byte ranges were identical to the originals. Output sizes were
1,202,004, 42,720 and 212,625 bytes; exact source/output hashes and temporary paths
are retained in `docs/pptx/zip-writer-evidence.json`. Final built serialization
was compared to those independently verified output hashes. No corpus failure
required a new regression. No rendering or visual CLI change was involved.

The receipt accounts for 16 relevant unit cases and seven expanded BDD scenarios.
Five physical writer cases have original byte/language-mapping evidence; five
graph writer cases have byte-layer evidence and explicitly pending graph work;
six content-type/save cases and all seven public-model BDD acceptances remain
pending. None are silently counted as complete. `Presentation.save` remains
visible with its exact neutral async signature and capability-based I/O mapping.

Only the six new owned files are included in the local atomic commit. The existing
dirty pipeline plan, research inputs and unrelated work are preserved. No README,
fixture binaries, public export, CLI route, root runtime, push or release changes.
