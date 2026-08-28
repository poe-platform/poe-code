# Independent breadth precode review — August 28, 2026

## Verdict

**PRECODE HOLD: three actionable readiness blockers; historical/data preservation accepted.**
This is a bounded static review of Raman's proposal at
`a045139b62164dbae923475bdca93ef109b926ff`, not an execution acceptance or a
review of concurrent executor development. No product, comparator, native oracle,
existing harness, build, install, network, private engine, timing cohort, or sort
sample was executed. Python standard-library data operations and read-only Git
were the only checking machinery. No product/comparator modules were imported.

The eleven frozen packet files match their current file bytes. All ten manifest
entries and all 23 immutable input bindings authenticate. The current directory
also contains an unsealed `executor-preparation-v1/` peer directory, absent from
the author commit. Its contents were not inspected or admitted. That addition
fails the author's exact live-directory check; it does not invalidate the sealed
Git packet or authorize incorporating concurrent code.

## Blockers and required handoff

### B1 — W03 needs an engine-specific observation contract

`tests/comparison/breadth-continuation-20260828/WORKFLOWS.json:123` declares four
stdin chunks, forbids scalar-string fallback, and requests dispatch, timeout-timer
and iterator-settlement observations. The existing, historically sealed adapter
at `benchmarks/reports/current-comparison-20260827/execution/breadth.mjs:118`
supplies target stdin as one Buffer and comparator stdin as a Latin-1 ByteString
with `stdinKind: "bytes"`; it does not supply that four-chunk producer or collect
the requested iterator/dispatch/timer evidence. Its comparator stdout conversion
uses `stdoutAsBytes`, not UTF-8 decoding; this is a concrete historical byte path,
not evidence that binary bytes must be lost. Comparator stderr is explicitly
derived UTF-8 text at `breadth.mjs:128`, not independently raw stderr.

Before freezing an executor, name and hash the exact admissible byte adapter and
state which W03 observations each public API can actually expose. Explicitly
distinguish a legitimate byte-tagged ByteString API from an ordinary string
fallback. Do not infer chunked streaming, timer ownership, child dispatch, or
iterator cleanup from matching seven-byte output. If the pinned comparator has
no applicable capability, retain an honest profile gap/HOLD, not an invented
hook, hidden prebuffering, weaker byte oracle, retry, or target-only comparative
pass. The frozen literal `00 ff 41 0a 0d 80 00` remains unchanged.

### B2 — Exact namespace and the 64-entry cap lack a scoped adapter contract

`tests/comparison/breadth-continuation-20260828/EXECUTION.md:52` requires exact final
namespaces and preservation; `EXECUTION.md:92` caps new-workflow final entries at
64. It does not state whether that cap and namespace encompass `/fixture`, the
whole VFS, or engine scaffolding plus fixture entries. This matters concretely:
the old adapter traverses `/` at
`benchmarks/reports/current-comparison-20260827/execution/breadth.mjs:48`, while the
immutable `cohorts/historical-breadth.json:3651` getopts record contains 192
comparator before/after entries for an empty declared fixture (target: five).
The column record contains 193 comparator entries with one input file. These are
historical recorded observations, not new counts or proof of a newly run layout.

Unmodified whole-root census reuse therefore has a known admission/cap conflict
to resolve. Preseal the namespace root, immutable permitted scaffolding, exact
extra-entry predicate, and separate total-resource versus fixture-effect bounds.
Retain detection of unexpected effects; do not simply ignore paths, fabricate
product setup effects, enlarge a cap after seeing output, or alter any legacy
oracle. If a versioned additive profile is needed, declare it before execution.

### B3 — Concrete controls, adapter, loader and supervisor are not presealed

The author packet contains data, prose and its data validator, not the proposed
executor. `tests/comparison/breadth-continuation-20260828/README.md:52` correctly
requires a later concrete implementation seal; `CONTROLS.json:1` contains twelve
proposed controls with zero executions. Historical runner files do exist, and
four selected files match both their committed hashes and old staged bytes, but
they are not automatically the new executor:

- `execution/breadth.mjs:98` waits one `setImmediate` before reading registration;
  the new `EXECUTION.md:62` instead requires the real plugin setup barrier and C11.
- `execution/observe-load.mjs:22` checks supplied loader source bytes when present,
  but records `evaluationProven: false`; a null-source CJS load is not authenticated
  executed source by that branch. Disk identity, resolver receipt, loader-returned
  source and module evaluation are distinct evidence. The new
  `EXECUTION.md:24` requires actual-load/moved-layout and relevant CJS/worker/WASM
  binding; that stronger evidence has not been supplied by this packet.
- `EXECUTION.md:99` appropriately demands disposal, stream/tracked-work settlement,
  exit **and** stdio close, process-group absence, and unsafe-failure stop. Those
  are proposed obligations, not new resource receipts. C09/C10/C11 must use the
  actual owned supervisor/admission paths. C05's in-memory cases must exercise
  the designated guard, not be mislabeled as proof of real filesystem traversal.

The next owner must seal exact adapter/supervisor/loader/control bytes, tool
identities, complete package/dependency views, public API bindings, counters,
offline and physically moved isolation, denied old/source paths, failure
attribution, and pre/post **new-entry** guards before any actual cohort. Reuse
requires explicit immutable old-runner binding and disclosed changes. Controls
must then be authorized and checked before their results can support execution
acceptance. No concrete implementation or runtime proof was created in this
review, and the concurrent peer directory is not a substitute for that seal.

## Verified identity and availability

| Object | Independently established identity |
| --- | --- |
| Author MANIFEST | SHA256 `19526e0eb11478107b73026bdcc5d3b309f4cfb38c57a93c7cfea1672e75e923` |
| Accepted target | Commit `67eab12e315054907ef4ef435c6bbca2f59e0c36`; root acceptance remains a prerequisite, not replayed |
| Actual target tarball | 749,907 bytes; SHA256 `6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06`; 858 unique archive members |
| Actual just-bash tarball | Pinned **3.4.2**, not latest; 9,879,070 bytes; SHA256 `f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d`; 955 unique archive members |
| Old dependency-closure manifest | SHA256 `de60cebabeede33fa5718dbee72e73301b39651db2ec2e607c4a1fa455d0d94d` |
| Old execution binding | SHA256 `1c74655402eba80a12e1c190fa43ba6923faace8a7db81c7f17da8a3b4528b1e` |
| Old breadth adapter | SHA256 `e798b84be8f49e4966a1f9df3e4e6438c3b2ec6618821339705e140e572ba2d8` |
| Old load observer | SHA256 `57873f1dac8fd4dc2e028b119004091bce59d9dbbd84077f88cb4f7a0189dc2b` |
| Historical cohort data | SHA256 `c4e322ce7a81c7909cd54121e4a435152c4a2eb9e1b2f69b5c09ba0f858e396a` |
| Prior extracted breadth inventory | SHA256 `1fa3d5c30a1c4aa3106d5b794b9dcca7b17eba95510aedfad26093406a99d7bd` |

Both named tarballs are actually available at the exact recorded temporary paths;
their bytes were hashed before/after archive metadata listing, without extraction
or execution. They have no duplicate names or absolute/parent-traversal member
paths. These checks are not full extraction admission or a build reproduction.
The target tarball location/member receipt was independently found in the frozen
public-package section of
`tests/integration/timeout-curl-safejs-20260828/BINDINGS.json:1` (file SHA256
`8626a2524018b12f6fb8edce67efb1f47d7ff7b679849acc88ada39501f00d10`), not inferred
from the proposal's bare target hash. No referenced private repository was queried.

All 3,844 declared comparator closure files are present at the historical staged
root. Of these, 3,843 have matching SHA256, byte count and mode; the remaining
`just-bash/dist/AGENTS.md` is metadata-only (present, 9,231 bytes), deliberately
not read for proof. No closure new-entry census or whole-closure post-run guard
was performed; no newly loaded dependency, CJS, worker or WASM execution is proved.
Consequently this is **availability plus bounded file authentication**, not a
fully admitted execution closure or independent dependency-publisher attestation.
No download, install, reconstruction or private-engine substitution is warranted.

The 23 author's Git input bindings match their pinned commits. Two referenced
candidate source files differ from today's live bytes (`src/shell/runtime.ts` and
`src/shell/shell.ts`); `evidence-v2/RESULT.json` records both hashes. They were
read as historical data, never executed, replaced by live inputs, or treated as
reasons to reject the unrelated immutable candidate archive.

## Historical preservation and eligibility

The 54 IDs and ordering match the prior extracted inventory. Its independent
historical cohort source has 61 `cases`: **54 target cases plus seven controls**,
and seven additional diagnostics. Controls and diagnostics are not target rows.
Summing preserved operational flags gives **13/54 target versus 47/54 comparator**;
the final historical receipt also records **50 raw comparator predicate matches**,
not 50 operational passes. Prior raw-record hashes for 53 non-XAN IDs / 106 engine
records match the bound archive audit. That audit's historical archive hash is
`9e2d3c24c709e7b5cd9ca6a7a8022e13f1e97c58ca235587562b5354cdf5932a`;
the large historical raw archive was not reopened, so its old authentication is
bound rather than newly repeated. XAN remains only an opaque ID/hash/flag row.

All 23 selected recipes equal the originals, including compact JSON recipe
hashes, effective scripts, argv, environments, fixtures/modes, input bytes,
30-second budgets and expected predicates. This is normalized JSON recipe-byte
identity, not a claim that pretty-printed snippets in different files are equal.
The 53 non-XAN expected-object hashes and historical recipe objects also match;
held recipes were not rewritten to admit absent commands.

| Eligibility category | Rows |
| --- | ---: |
| Eligible unchanged | 20 |
| Eligible unchanged, known profile gap | 3 |
| Held missing in pinned candidate | 17 |
| Future readiness only | 5 |
| Excluded host/process/runtime profile | 5 |
| Held language and command | 2 |
| Excluded owned elsewhere (XAN) | 1 |
| Excluded non-equivalent optional engine | 1 |

Thus 23 selected = 13 old positives + nine now-present static command/builtin
rows + tree; the other 31 stay held/excluded. Registration/name presence is only
eligibility, never a fresh functional pass. getopts is a builtin, not an invented
79th registry command. The independent 78-name inventory matches the binding;
curl and SafeJS remain optional, not enabled aggregate commands.

The retained DU output is `2\tdata.txt\n` under the original allocation profile;
the unknown-allocation Memory gap is not repaired with apparent size. The retained
which output is `/usr/bin/echo\n`, not a license to create an echo path. The old
tree output, root/footer/charset mismatch and failures remain untouched. Of the
23 selected stdout oracles, 21 specify exact bytes and two intentionally retain
partial predicates: file includes `ASCII text`; HTML includes `# Release` and
`**now**` and excludes `<h1>`/`<strong>`. Sleep still requires at least 10 ms.
All retain exit status zero, empty stderr and input/effect predicates. None was
run here. See `LEGACY-RECIPES.json:1` and `ELIGIBILITY.json:238` in the author packet.

Stack (dirs/pushd/popd), shopt/dotglob and YQ remain three future gates covering
five unchanged recipes; LET stays absent from this pinned candidate. User-supplied
CD464 acceptance corrects status interpretation, not target composition. There is
no new YQ, stack, dotglob, XAN or optional-engine qualification. `js-exec` is not
SafeJS; the old engine/lifecycle failure remains, and no retry/reroute was made.

## Literal additive oracles

These are independent static readings of frozen literals, not observed passes or
native goldens. All ten require status 0, empty stderr, initial byte/permission
preservation and exact declared final effects; new-file modes are intentionally
not compared. Full base64, script hashes, added-file hex/hashes and absent paths
are in `evidence-v2/RESULT.json`.

| ID | Exact expected stdout | Added files / effects |
| --- | --- | --- |
| W01 | `alpha\nbeta\n` | `selected`, same bytes |
| W02 | `alpha\nbeta\ngamma\n` | `part-aa`: first two lines; `part-ab`: last line; `joined`: all three |
| W03 | Hex `00 ff 41 0a 0d 80 00` | `copied`, same seven bytes; B1 limits apply |
| W04 | `n:3\n` | `result.txt`, same bytes |
| W05 | `# Release\n###### Notes\n` | `rendered.md`: `# Release\n\n###### Notes\n` |
| W06 | `4\ta.txt\n6\tb.txt\n` | `sizes`, same bytes; explicit apparent-byte recipe, no old-DU parity credit |
| W07 | `/fixture/bin/tool\n` | `resolved`, same bytes; declared mode-0755 virtual file, not registry lookup |
| W08 | `payload: OK\n` | `sums`: exact SHA256 of `abc\n`, two spaces, `payload\n` |
| W09 | `kept\n` | `snapshot`, same bytes; `stage`, `stage/copy`, `stage/final` absent |
| W10 | `a.txt\nb.txt\n` | `listing`, same bytes; hidden input preserved; no dotglob claim |

W08's digest was independently computed as a mathematical data hash:
`edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb`.
W01/W10 mention sort only inside unexecuted proposal text; **sort samples remain
zero**, and the pre-existing zero-sample admission failure is neither repaired nor
reclassified. Ten new workflows never replace/rescore the 54 historical IDs.

## Controls, lifecycle and claim limits

C01–C12 cover wrong identity, oracle tamper, source fallback, selected-load mismatch,
fresh-view metadata, binary corruption, status/stderr, namespace preservation,
leaked lifecycle, unsafe continuation, plugin admission, and no-op substitution.
They are reasonable requirements, not implemented/presealed controls or observed
negative rejections. Every proposed control execution count remains zero.
The proposed ceiling is arithmetically 33 cases × three layouts = 99 semantic
invocations, plus at most 24 control children = 123. This is a budget, not an
execution count. Installed/moved target repeats are not 66 distinct workflows.

The proposal forbids retries and continuation after unsafe binding/resource
failure, demands natural cleanup before credit, and distinguishes comparator
text-stderr boundaries. Those requirements are retained. No operational credit
can be inferred from status/output alone, forced termination, unobserved late
work, or a snapshot of possible loadable files. The old loader's limited proof
must not be promoted to evaluated-module proof. No installed/moved execution,
offline denial, provider interoperability, performance ranking, overall just-bash
win, combined union score, full current gate, or 72-hour completion is established.

## Evidence, attempts and ownership

- `evidence-v2/RESULT.json:1`: **402 static assertions: 400 true, two false**.
  Both false checks concern exact **live directory membership**, because the
  unsealed peer directory exists. The checker exits 1 honestly; this is not a
  product failure or a frozen-packet integrity failure. All 11 protected frozen
  files still match; current new-entry detection is not silently disabled.
- `evidence-v1/RESULT.json:1`: preserved first completed checker capture,
  394 assertions / 391 true / three false. One extra failure was my checker
  counting seven historical controls as target cases; v2 fixes only that data
  classification, preserving the original result and script bytes in
  `static-review-v1.py.data`. It is not an author defect or changed cohort.
- An earlier checker attempt stopped on missing `rawBindings` for the deliberately
  opaque XAN row, before writing an evidence directory. The correction skips
  unavailable opaque fields, not any operational score or test. Two guessed
  historical paths and an exploratory list/dictionary mismatch also failed
  read-only inspection; no runtime was started by any attempt.
- The owned scope was absent/untracked-empty on initial inspection, with an empty
  staged index; first recorded HEAD was
  `ff872ec469e327e4de61e8ab2bf3367344c9303a`. Later evidence captures the concurrent
  Git state without adopting it. All writes are new files under this owned
  directory. Foreign edits, native scratch directories and staging are untouched.
- `static-review.py:1` is a standalone standard-library data checker. It executes
  only an allowlisted set of read-only Git commands; it never imports or invokes
  specimen code. A future explicit rerun must choose a new direct-child output
  directory (`--output evidence-new-name`); existing evidence is never overwritten.
  Archive listing does not extract files, and dependency hashing does not execute
  them. This is not an execution harness or an expanded workload.
- `SEAL.json:1` binds this report, both captures, and both checker versions.
  No owned long-running process remains. Atomic commit uses only explicit owned
  paths; the final response supplies the commit identity.

**Next gate:** resolve B1/B2 in a versioned pre-execution contract and obtain B3's
concrete immutable seal and separate authority. Do not start a cohort from this
review, the old adapter, moving HEAD, or the unreviewed peer directory.
