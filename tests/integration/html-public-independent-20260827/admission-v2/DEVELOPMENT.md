# Admission-v2 development chronology — 2026-08-27

This is the implementation worker's record, not independent acceptance. No
subagents were used. Only this new `admission-v2` subtree is owned. Root's
separate Raman review and the actual frozen34case cohort remain pending.

## Preserved mistakes and boundaries

All binding attempts were hash-only Git/tool investigations. No attempt ran a
candidate runtime, compiler or npm. The retained `PRE.json` files identify the
code in effect before each attempt; `FAILURE.json` preserves the exact failure.
Earlier source versions were not committed before repair; their PRE hashes are
identities, not claims that their old complete source snapshots are present.

1. `binding-01`: the first metadata reader incorrectly applied a portable build
   pathname rule to all historical Git names. It rejected the authentic inert
   `controls/back\\slash` filename before reading the receipt. The corrected
   reader distinguishes POSIX Git metadata names from buildview paths. Literal
   tabs, backslashes and newline characters in historical regular filenames
   remain metadata only. NUL, absolute paths, empty components, traversal, `.`,
   `..` and `.git` components remain forbidden. Build paths additionally reject
   backslashes, colons and line breaks. No historical fixture was extracted.
2. `binding-02`: the first input-envelope assertion compared all410 input
   records to the author's smaller253-record envelope hash. The author script
   explicitly hashes all248 `src/` entries plus package/package-lock, two
   tsconfigs and README. That exact original envelope remains
   `0e7342e1dce75b2bce4c7501fd308e6d263845630bb8fa6372ed6d632aeec6eb`.
   The complete410 records have the distinct hash
   `1886e217c0cf4c9f4a9c7a19a9d747fbb06660f6e201530785975cdec200c257`.
   Neither hash is the full Git archive hash.
3. `binding-03`: a32MiB buffered blob guard rejected the declared
   `tests/commands/html-to-markdown/inline-normalization-fix/EVIDENCE.json.gz.base64`
   input, which is54,963,817bytes. This was surfaced before repair. The buffered
   guard was not raised; all410 input blobs now use bounded64KiB streaming,
   validating both Git blob identity and SHA256. The total410 input size is
   65,377,928bytes, within a separate128MiB materialization total limit. The
   full2.34GB archive is never buffered or materialized. No declared input was
   dropped, reclassified out of the410 list or substituted from live source.
4. `binding-04` is the first successful binding. Its exact SHA256 is
   `7df791cf7c7c0010af85726af9d9e78dcdebbdaff0c182fb9670be6e29b8989a`.
   Later harness files are bound by their own pre-run inventories and final seal;
   they are not falsely attributed to this earlier binding snapshot.

Initial terminal investigation accidentally printed the oversized receipt and
a large Git path delta. These were terminal-output mistakes, not multi-GB file
extractions or candidate execution. Subsequent inspection used bounded summaries.
Two later combined source/document patches were refused because their README
context did not exist; neither changed a file. The source addition and narrow
README patch were then applied separately. These were editing mistakes, not
candidate executions or hidden test failures.

## Original admission rejection attribution

The exact committed receipt and its parent README report the12historical
symlink rejection and the frozen runner's1GiB archive-buffer hazard. All52 raw
author capture entries were authenticated, but none contains the original
independent runner/declaration rejection log. No original raw rejection is
fabricated. The new synthetic frozen-inventory control is explicitly NEW and
does not claim to recover or reproduce the original full-candidate launch.
The unsafe old full archive buffering path was never launched.

## Fourteen-path discrepancy

The current receipt supplies six changed product paths, not a14path
reconstruction list. Actual Git evidence shows `aff899aa` is reachable from
author `9dc858c8`. Its direct reachable parent is
`b983a37fa8bc322d707867afa9250f88fb408e0a`; its exact delta is two files:

- `tests/plugins/html-to-markdown-public-author/lifecycle.ts.fixture`
- `tests/plugins/html-to-markdown-public-author/verify-public.mjs`

Both exact blobs are present at the reachable author commit. The lossless raw
candidate commit body is sealed separately. Reconstruction uses this actual
two-path delta, not an invented14path list. This discrepancy is a root/reviewer
handoff limitation, not a silent waiver of a supplied14path binding.
