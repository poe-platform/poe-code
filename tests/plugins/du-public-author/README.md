# DU75 public integration author handoff — 2026-08-27

**Ready for different-agent review, not independently accepted or a full gate.**

## Exact candidate and artifacts

| Artifact | Identity |
| --- | --- |
| Executed candidate | `0895de2dc63014989f23912c3d48f7c4d0d35a47` |
| Candidate tree | `0d6fe4cc764e047c0f4c9eb93cfaa3824be36965` |
| Source/export/docs commit | `b2b4604f09f351d8130c0f2a3349e85f4b4c45e1` |
| Exact current fixture migrations | `9cccda89e185b80f31d011797b97a27c47a691ff` |
| Public author fixture/harness | `e0f16316dc40762bcb909a8507c3bb9afa706817` |
| Pre-execution diagnostic assertion correction | `17284b9b21f4081be1117c5c19924a71bbebb9e6` |
| Archive helper correction | `0895de2dc63014989f23912c3d48f7c4d0d35a47` |
| Actual complete npm tarball SHA-256 | `4d4d071a0142ac950240f7c3aaacd5283777143d70cc2e3c245ba199fdd01c7d` |
| `package.json` SHA-256, not tarball | `60e3e3934d46b410a428784b5c1ce687a72cb59791a46a6b821dfa78c31dde8d` |
| Review handoff JSON SHA-256 | `1ff91fcf815f57a895bf46d4aeca8e5da488971d918009dbb1d24b356e7f5b8a` |

`evidence-v1/REVIEW-HANDOFF.json` contains all771 selected Git input paths,
SHA-256s and blob IDs;834 installed and832 emitted file hashes; exact75 literal
names and previous HTML74 names; tool identities; observations and source policy.
The771-file input set is a scoped committed archive with all product/build inputs
and chosen test helpers, **not** an entire historical repository archive. File
counts exclude directories; raw inventories include directories too. Root and DU
bytes are actually observed loaded from the moved installed package, not merely
present in its manifest. Main-thread trace only, no worker-transitive-load claim.

HTML74 `aff899aa94ed0c57a936b08fd36d185688f5c0bb` and its tarball remain unchanged.
The source/package delta versus that HTML candidate contains the DU integration
plus separately authored private `src/shell/cancellation.ts` (`67472272`, four
emitted files). The latter is neither imported by the captured public programs
nor semantically approved by DU verification. This is disclosed package content,
not a new default command or an author-certified cancellation component. New
first-read canonical test commits in candidate history are outside this selected
cohort and are not rerun or accepted here. Expr remains absent from defaults.

## APIs and lifecycle policy

See `POLICY.md` for exact signatures, diagnostics and all eight mappings requested
by Raman's unchanged29-case freeze `1bd1048b0075adf9ee1ebf041e299122f72c3459`.
Root/subpath export `createDuCommand`, `createDuCommands`, `duCommands`, types
`DuCommandsOptions`/`DuLimits`. Aggregate key is `du`; its options omit `replace`,
which remains top-level authoritative. Explicit subpath is
`virtual-bash/commands/du`. Default75 = HTML74 + du; curl/SafeJS remain optional.

Only DU `du.ts`/`budget.ts` behavior changes. Existing argument/format/options and
accepted metadata profile remain. Optional owned stdout enrollment starts after
validation, before metadata; one budget spans parse/walk/output. Operation signal
applies to metadata/stdout, original caller to required stderr. Direct exact close
reason is rethrown; no new status141/success normalization. Required file output
survives unrelated downstream closure. Local owned waits/cleanup are awaited;
underlying opaque provider promises can remain pending and their late errors are
observed, not misrepresented as retired. No host preemption or universal async
provider-cleanup guarantee is introduced. Raman's overlapping dispose/sibling
holdouts are still independent work, not claimed as author executions.

## Executed author evidence

- Build passes on the frozen candidate. Strict scoped source and moved public
  consumer types pass; four negative consumer diagnostics are exactly the four
  expected locations/codes. Declaration trace checks bind root/subpath to this
  built package, not source or another package's contracts.
- **166/166 source tests, zero fail/skip/TODO:**102 unchanged DU non-native tests,
  13 new DU lifecycle/public tests, nine current HTML lifecycle tests and42 current
  registry tests. No native DU or external service replay in this integration.
- Eight actual moved-package programs pass: public six-workflow consumer,
  13-case lifecycle consumer, maintained stream consumer and options consumer,
  each on Node22.22.2 and24.11.1. Literal75 inventory and optional absences checked.
- Four no-fallback controls pass (missing root JS, DU JS, explicit export and
  DU declaration); two actual source-read permission denials pass. Runtime probes
  separately verify allowed consumer reads/forbidden writes and source denial.
- 20 harness commands and22 checks pass, no timeout/signal failure. Package,
  emitted tree and selected source/test/artifact inventory are unchanged with
  **added-entry detection**, not only original-file rehashing. All synchronous
  child runs completed naturally; no author server/watch process remains.

Node22 executable SHA `5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`;
Node24 SHA `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
Both are installed Darwin arm64 profiles, not a latest-release claim. TS5.9.3
compiler hash and exact dependency metadata hashes are in the handoff. Zero
runtime dependencies remain; no private checkout or global configuration writes.

## Failed attempts and exact fixture migrations

The first isolated17284 run omitted read-only `tests/fs/webdav/mock.ts` from its
archive: source157 tests/156 pass/one module-loader failure; scoped types had the
missing import and derived callback diagnostic. Its full package build/types and
all eight moved programs already passed, but the **attempt is failed**, not a
whole author pass.0895 adds that one helper to archive selection, no source/test
expectation change; the final166 execute. Both attempts have identical tarball SHA.
Three report failures (loader/count/type checks) are retained, not rescored.

Earlier source115/115 then166/166 runs are preserved separately. An initial ad-hoc
strict check exposed new author Promise-union typing plus wrong default DOM libs;
the test typing was corrected and the checker used project `lib: ES2023`, not a
foreign WebDAV source patch. Both original/final diagnostic logs remain. The new
public conflict diagnostic assertion was corrected to the already-existing DU
message before its first execution; that is not a product fix.

The9ccc migration changes only two literal registry fixtures (including custom
75→76), current HTML lifecycle's DU-present assertion, two maintained consumer
count/suffix assertions and their exact inventory hashes. Previous74 inputs/results
remain in Git and HTML's frozen evidence. It does not waive historical assertions,
change command semantics or claim all previous gate failures closed.

## Reproduction and review handoff

Run the committed author verifier from this repo with an explicit frozen SHA:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node \
  tests/plugins/du-public-author/verify-public.mjs \
  0895de2dc63014989f23912c3d48f7c4d0d35a47 \
  /Users/kjopek/.nvm/versions/node/v24.11.1/bin/node
node tests/plugins/du-public-author/verify-evidence.mjs
```

The first command creates a fresh isolated regular archive/build/pack/consumer;
the second authenticates saved evidence only. `RAW.json.gz.base64` is a lossless
52-file capture of both attempts and prior source/type logs; hashes and decoding
are specified in `MANIFEST.json`/`verify-evidence.mjs`. Capture used the read-only
generic HTML capture helper with an exclusive new DU output directory. It does
not rewrite any historical HTML evidence. `seal-bindings.mjs` also refuses to
overwrite its existing receipt and authenticates the unchanged reviewer manifest.

Root should route candidate, tarball identity, `POLICY.md` and the review receipt
to Raman. `rootReplayAuthorization` is deliberately null: the author does not
fabricate a signed root instruction or replace the independent supervisor with
its own harness. Raman's17 blocked specifications require separately bound
executors/mapping acceptance; his freeze itself is not29 executed cases. No new
whole-product/typecheck-all gate ran, no public DU independent acceptance is
claimed, and queued expr76 remains unwritten.
