# Additive root action correction — preparation only

2026-08-28. This correction supplements the durable original authorization
`7e83d873223f10df5f48271bf2afe31bfc9983ab`. The real full40-character commit
containing this document becomes the new rootReceipt in a subsequently written
separate grant-v4.json. No receipt is invented or self-referenced here.

## Authoritative root correction, preserved verbatim

> ROOT corrects my stale action token: use exactsealeddispatcher action='execute-array-successor-v4', NOTv3. Thiswasrootreceipt-preparationmismatch, zeroattemptsconsumed; preserve8500e063/v3grantbytes unchanged asUNEXECUTED. Commit additive rootcorrectiondocument referencing7e83d873 andsameallboundscandidate/seal/dispatcher/pack; itsreal40commit becomesnewrootReceipt. Create separategrant-v4.json with onlyaction/newrootReceipt changed, returnrawSHA/bytes/path/commit andexactcommand. No dispatcher/seal edits, sameunusedlabelARRAY-S06-20260828-01. Correctsourcecensus269selectedinputs asreadiness; myearlier'271?'wasnotadditionalinputpermission. DoNOTdispatchuntilrootconfirmsnewrawhash; no build/prodexecutionyet.

## Exact unchanged bindings and restrictions

- Action corrected only to `execute-array-successor-v4`.
- Candidate: `c0adae539c736db0e4023d401562ce958d9ebb00`.
- Selected tree: `30f88590b66b88dc9694a56c85f1ee690f02218b`.
- Whole862 package SHA256:
  `e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3`.
- Seal SHA256:
  `c7f198821b82f8ce2661913b944211b747de2bd5a4017c431406687cda212d80`.
- Dispatcher SHA256:
  `ee5f7e1d17d7ce47dc7bdd6de757923180c8bd46add0f854fda960bbbc374807`.
- Same unused label: `ARRAY-S06-20260828-01`.
- Exactly269 selected source inputs; the earlier `271?` grants no additional
  source inputs. Expected272 Git children remain269 blobs +2 checks +1 capsule.
- Scope unchanged:33 semantic,22 mechanical,16 holdouts, P01–P10, AST4,
  types10 each in three layouts,12 mutants plus S06 and positive controls.
  M21 remains source-only and five mechanical obligations remain mixed.
- Expected345 children, maximum373/374 including coordinator; concurrency1;
  110-minute total from pre-admission through final publication/cleanup;
  128MiB captured output and512MiB working storage.
- One attempt regardless of outcome, no retry/rescore/new loops. Ordinary
  assertions aggregate only after known cleanup/integrity; safety, integrity,
  capture or unknown-reap failure stops dependents. Priority command work is
  not interrupted by this already-prepared review.
- No product/seal/dispatcher edits, build, product/native/private/YQ/XAN
  execution. All original failed harness/c7 outcomes and H12 held history stay.

The v3 grant in8500e063 remains **UNEXECUTED and byte-identical**, SHA256
`1f3d72fb78879f7b93c7835d8865da75dea90bb5549bcfca17095624bd6d74dd`.
Only action and rootReceipt may differ in the separate five-field v4 grant.
Zero attempts have been consumed. Dispatch remains prohibited until root
confirms the returned new raw grant hash. The receipt's40-hex format check
alone is not root authorization or proof of Git membership.
