# Independent tree/file public integration review

Reviewed frozen candidate **79316dfe792d9342eda2cedff503f98f431778c4**, containing
Curie's1ad428ed wiring and separate2ae131a9 count migration. This reviewer authored
neither underlying family nor wiring. Scope is public integration, not a new full
native-parity audit. No product code or original test assertion changed.

## Executed results

- Unchanged author replay:199/199 selected source tests, moved packed13/13 twice,
  two adjacent strict/runtime consumers, six intentional type errors, five
  import/source-access denials. Zero skips/cancellations/TODOs.
- New independent moved-package tests: **11/11**, six negative type uses exactly
  TS2353/2353/2322/2322/2353/2353, four missing tree/file root/subpath imports plus
  one denied source read. No source fallback, private package or runtime dependency.
- Both independent packs reproduce the author's706-file artifact SHA256:
  `c61274d0fcf14fe4a8dfd3a7b8e1039d51ea914d4eb39617d7a191a5a60202b9`.
  Root/subpath factories are identical; the literal registry has exactly70 unique
  names, including tree/file, excluding optional curl/SafeJS.

Holdouts cover typed root/subpath options, factory versus plugin dispatch,
aggregate replacement authority against nested overrides, standalone isolation,
tree JSON through tee/file with actual VFS readback, binary stdin and symlinks,
tree partial-output limits, file fallback read bounds before content access,
ENOTSUP metadata refusal without reads, bounded sniff producer closure and host
environment preservation. The unchanged author replay additionally exercises
caller cancellation/late rejection and iterator closure. No real adapter service
or arbitrary-provider sandbox guarantee is inferred.

`tree` can publish a prefix before failure; it is not transactional traversal.
`file` sniffs a bounded prefix, not full libmagic/document validation. Neither
limit nor partial-output policy was relaxed. Existing time-env `%-N`/ICU/native
profiles and external SafeJS lifecycle findings remain outside this review.

## Isolation and retained setup failure

The independent runner archives the exact commit, copies regular development
tool files, builds, packs offline with actual README, extracts a real package,
moves the consumer and withdraws source. TypeScript5.9.3 checks strict ES2023
NodeNext declarations with skipLibCheck:false. Plain Node22.22.2 executes emitted
JS with filesystem access limited to the consumer and without child-process
permission. No network is used or network-confinement claim made. Raw commands,
tool/source/package hashes, emitted results and cleanup are in `evidence`.

`holdout-first` retains the first strict-compilation failure TS2379: the new
test wrapper accepted Partial<FileSystem> but tried to represent an absent
optional readStream with undefined. Its test-only override input type now
explicitly permits undefined; neither FileSystem nor an expected result changed.
The final run passes11/11; original failure is not counted as a product defect.

```sh
node tests/plugins/filesystem-inspection-public/verify.mjs 79316dfe792d9342eda2cedff503f98f431778c4 /tmp/inspection-author-replay-unique
node tests/plugins/filesystem-inspection-public-independent/verify.mjs 79316dfe792d9342eda2cedff503f98f431778c4 /tmp/inspection-independent-unique
```

Both runners remove exact owned scratch in finally. This is bounded independent
integration acceptance, not a full suite, native superiority or release claim.
The separate release coverage repair needs Curie's different-verifier review;
see `tests/integration/qualified-current-release-repair/README.md`.
