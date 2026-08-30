# Prospective test matrix — zero native/product executions

This is a design preseal, not executable acceptance or independently frozen
holdouts. Future independent reviewer should add hidden vectors before authoring.
The six neutral proposed outputs remain unverified expectations until approved
oracle execution; corrections must preserve original data/history.

| IDs | Required positive / negative obligations |
| --- | --- |
| D01–D06 | Nearest nested repo, cwd/-C boundary, bare queries, safe gitfile, linked commondir/per-worktree index, detached/unborn HEAD; outside/symlink/cycle/nearest-unsupported refusal |
| C01–C04 | Config escaping/boolean syntax, safe irrelevant keys, mode false/true capability, active include/filters/attributes/unknown formats/routing-env refusal without any host call |
| R01–R05 | Loose override packed refs, tag peeling, full OID/HEAD/parent, ambiguity, symbolic/tag cycles; truncated/invalid/duplicate packed rows and missing ref/object remain failures |
| I01–I06 | Neutral DIRC v2 and independent v3; sorting/stage combinations; checksum/length/padding/flags errors; optional versus mandatory extension; split/sparse/v4/intent-to-add refusal; absent index versus unborn HEAD |
| O01–O06 | Every object type, exact binary blob, hash mismatch/size mismatch/trailing member, invalid tree entry/mode/duplicate/order, cycle/depth limits, decompression bomb/overflow before owned growth |
| S01–S06 | Neutral XY, all seven unmerged stage shapes, tracked ignored files, untracked normal/all/no, nested ignore negation/excluded parents, C-quoted/UTF8/NUL paths; unsupported active syntax fails not false-clean |
| F01–F06 | Working/cached/revision diff, add/delete/mode/missing-LF, stable text patch, binary name/status/show, exit0/1 distinction, magic pathspec/rename/driver/binary-patch refusals |
| H01–H04 | Two-commit neutral log/show, merge explicit-first-parent, bounded subject/format/ancestry, unsupported history/shallow/promisor cannot silently truncate |
| P01–P07 | Independent real pack nondelta/OFS/REF; idx/checksum/CRC corruption; offset overflow/overlap; copy/insert/base/result bounds; delta cycles/depth; packed-only parity with loose graph; missing/thin/unsupported auxiliary data refusal |
| B01–B06 | Every limit at edge/+1 including empty chunks, no count-controlled oversized allocation, cache eviction charges, bounded diff work/yield, retained borrowed Buffer copies/offsets, short-read/truncation/mutation |
| L01–L07 | Preabort identity (including falsy reason), midread abort, early head-zero with enrolled cooperative source, backpressure, sink failure coincident with close, late acquisition release/cleanup failures, concurrent sibling isolation/no stdin reads |
| V01–V05 | Memory, actual read-only wrapper, Real with only new owned fixture root, S3 mock, WebDAV loopback mock; correct refusals for unavailable symlink/mode capability, no provider-specific fallback |
| A01–A05 | Zero mutating FS calls/zero invoke, no ambient process/fs/network/exec access, source and full installed/moved package, root/subpath optional integration/negative types later, original/current cohorts remain separate |

These rows are categories, not a denominator of executed assertions. M1A pack
unsupported tests are not M1B positives. A provider mock is not real service proof.

## First meaningful sequence

Decode NEUTRAL-FIXTURE.json into a fresh MemoryFS only after product execution GO:
two real commits/trees, three HEAD paths, two index paths, three working files.
Verify object/index checksums independently of the product, then exact status,
working/cached path lists, binary-preserving `show`, full-hash history and NUL
`ls-files`. Add `diff --exit-code`/`--quiet` and a simple full-index patch to the
next frozen native corpus; do not infer patch correctness from name-only output.
Mutation controls change one index bit, one inflated body byte, one ref, one mode,
one path prefix and one delta length, with independent expected failure boundaries.
Use no fixture source dependency that shares the product's parser implementation.

## Future native recipe — NOT authorized/executed now

1. Independently locate and authenticate one explicit Git binary/version and its
   actual dependency/tool route after a new grant. No download, ambient PATH,
   substitute Git family or invocation on existing repos. Pin executable bytes,
   version, args, environment, cwd, fixture hashes and expected stdout/stderr/status.
2. Materialize only this neutral fixture under a new owned temp root, never project/
   private/user repositories. Empty isolated HOME/XDG, locale C/TZ UTC, disable
   system/global config and pager, optional locks0, no external diff/textconv,
   explicit no-renames/first-parent profile; no network/helper route available.
   Current design performs no such materialization.
3. Run only the declared read-only commands, capture filesystem writes separately
   (including index refresh attempts and atime qualification); do not silently
   bless native writes as product permission. Verify bytes/names before/after and
   await owned children. No performance measurement in this phase.
4. For a separately authorized pack fixture, deterministic pack construction is a
   **fixture generation** operation confined to its new repo, not a product command.
   Capture real pack bytes/hash; do not simulate pack compatibility by merely
   deleting loose files or retaining a product-generated alternate object store.
5. Compare byte/status/effect assertions with versioned profiles. Both-sides-fail,
   unsupported formats and absent prerequisites stay visible; no broad skip or
   transform of divergent bytes into passing normalized output. Different hunk
   choices receive separate classification, not silent expected-output churn.

No Git process, native oracle, product, compiler, private copy or test runner was
invoked by this proposal. Data validation may decode these small literal blobs in
memory; that does not validate native acceptance or lifecycle behavior.
