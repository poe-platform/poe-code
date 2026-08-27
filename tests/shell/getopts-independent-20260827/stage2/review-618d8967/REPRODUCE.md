# Reproduce the selected review without live overlays

## Verify preserved evidence

From this repository, with Node22+ and Git objects reachable from main:

```sh
node tests/shell/getopts-independent-20260827/stage2/review-618d8967/verify-final.mjs
```

After locating the final evidence commit, append `--committed FULL_COMMIT` to
also compare every committed review artifact with that commit. Verification
authenticates prior Phase1/Stage2/policy boundaries and the seven immutable
correction-freeze files, the selected candidate's243 protected hashes, all988
archive source/test/build blobs, all830 real package files and all470 raw capture
records. It executes no product, native oracle or private engine. Unknown review
artifact membership fails. The exact `.work` scratch class is separately recorded
in evidence-v1/SCRATCH.json, then removed with enumerated ownership/hash checks;
its absence after cleanup is expected, not an unexplained tree omission.

The final layered manifest binds all review files except itself; the final Git
commit binds the manifest. Original exact-tree verifiers remain unchanged and
are not the correct invocation for this explicitly appended boundary.

## Source and emitted bytes

- `evidence-v1/candidate.tar.gz`: the exact original Git archive compressed once;
  MANIFEST.json records the decompressed archive SHA256. No live source overlay.
- `evidence-v1/candidate.commit.data`: raw Git commit body. Hash with Git's
  `commit LENGTH\0` framing to obtain618d8967009117547ab476256bc6eb0a9463309a.
- `evidence-v1/candidate.root-tree.data`: raw root tree; its framed tree hash is
  8cadf30519a179418fb2f7a859d6cf64ef1c8049.
- `BINDING.json` inside raw captures binds selected paths, every blob/mode,
  before/after closure, baseline/protected data and copied public tooling.
- `evidence-v1/public-package.tgz`: the actual npm-pack output installed and moved;
  its SHA256 is08667ba7a67c5e9342c062007265279965138afe99c700f756df3e8ec97533f3.
  It preserves all emitted JS/declarations/maps and the original package metadata.

Candidate618d8967 is an ancestor of main, not a synthetic/detached object. A normal
full clone retaining that main history supplies the complete Git tree/parent
graph, not loose-object assumptions. A shallow clone must obtain the actual
history before Git-backed verification. The selected archive is sufficient to
rebuild the selected implementation closure, **not** a claim to reconstruct all
unselected repository blobs or the entire parent history from the tar alone.
No user branch was created. If a future detached identity is introduced, it
requires a new self-contained object/bundle binding; this review introduces none.

## Inspect raw captures

Decode RAW.json.gz.base64 as Base64, gunzip, parse its files array, and verify each
entry's byte length and SHA256 before writing it to a new owned extraction root.
Do not overwrite existing captures. Entries carry their original relative names:
logs/LABEL/{PROCESS.json,stdout,stderr}, BINDING/PACKAGE/REGRESSIONS/PUBLIC records,
actual executed public drivers, original failed mutant attempt and separate v2,
SafeJS private before/after hash-only snapshots, child/import/assessor records and
adapted host binding bytes. No private engine source or public tool binary is
vendored. Process arrays include exact argv/cwd/env/versions, start/end, timeout
and output-limit settlement data. Metadata-Git commands and original preparation/
collection outer failures are separately documented, not counted as these64
bounded product/tool supervisor processes.

## Optional fresh replay, preserving existing evidence

Existing driver commits and any corrections are retained in Git. After verifying
the final seal and confirming no `.work` exists, the current drivers support:

```sh
node tests/shell/getopts-independent-20260827/stage2/review-618d8967/prepare.mjs
node tests/shell/getopts-independent-20260827/stage2/review-618d8967/execute.mjs build
node tests/shell/getopts-independent-20260827/stage2/review-618d8967/execute.mjs regressions
node tests/shell/getopts-independent-20260827/stage2/review-618d8967/execute.mjs public
node tests/shell/getopts-independent-20260827/stage2/review-618d8967/supplement.mjs
node tests/shell/getopts-independent-20260827/stage2/review-618d8967/holdouts.mjs
node tests/shell/getopts-independent-20260827/stage2/review-618d8967/safejs.mjs
```

The historical public command deliberately still reports its retained25/26
expectation error; do not use shell `&&` to suppress later independent steps.
The historical supplement deliberately reproduces the blocked first checkpoint
anchor; the corrected v2 loader and host-boundaries test must be invoked as in
their captured PROCESS.json records, with paths rebased to the new owned work
root. Both use the actual installed package and unchanged public positive tests.
No source fix, facade copy or old expectation rewrite is necessary.

All dependencies are regular copies of the explicitly recorded existing public
toolchain. npm pack/install is offline with scripts disabled and cache/HOME/TMP
under the owned work root. A missing or different toolchain is a prerequisite
change, not equivalent reproduction. SafeJS additionally requires the recorded
Node24 binary and exact legitimate private profile on this host; it must block
rather than install, edit private files, ignore drift or synthesize success.
Its original loader/guard and exact63-file closure remain enforced. The precise
temporary-root relocation is documented separately in SAFEJS-RELOCATION.md.

These commands exclusively create a fresh task directory; they never overwrite
evidence-v1. A later replay needs its own newly authorized versioned capture/seal.
Do not rerun collect.mjs against existing evidence-v1, edit the old manifest or
claim a new task tree matches the old SCRATCH.json. Archive verification and
new-run live membership are distinct boundaries.
