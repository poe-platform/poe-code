# Remaining harness v5 — preparation HOLD; no control launch

2026-08-28. Draft-source commit:
`683d3c3c7cdb9ac326fd76ba96e33388e193184d`.
This is **not** the requested successful source/preseal qualification. The
executable discovery preseal was never emitted. DRAFT-SOURCE-SEAL.json preserves
unqualified source only and grants no execution authority.

## Exact blocker and stop

One invocation of `author.mjs` exited1 at line72 before emitting its patch.
The assertion compared the frozen descriptors' `backend` fields against their
scoped **job IDs**:

| Frozen job ID | Actual backend | Incorrect author expectation |
| --- | --- | --- |
| real-scoped | real | real-scoped |
| mock-s3-scoped | mock-s3 | mock-s3-scoped |

Both frozen descriptors retain exactly P01/P06/P09/S41. The user-required scoped
job membership is present; the new author's field selection/expectation is wrong.
The failed assertion is retained unchanged in `author.mjs:72`. This is an
ordinary harness-authoring schema assertion, not a product/backend failure.
The empty patch passed to apply_patch consequently failed its patch terminator
check; no generated files were created. The tool returned terminal exit1 and
no continuing session. PREPARATION-TRANSCRIPTION.txt preserves the tool-rendered
diagnostic, **not raw pipe capture** or authenticated startup evidence.

Stopped conservatively under the no-retry authority. No source correction,
expectation relaxation, generation retry, environment probe, control launch,
product admission or rescore followed. Only read-only metadata checks, explicit
owned draft/evidence writes and atomic owned-path commits followed the failure.
The planned `evidence-author.mjs` was not executed; this HOLD report is separately
authored evidence, not a fabricated OUTCOME from the unlaunched owner.

## Exact execution and evidence limits

- Six controls R01/R02/R03/B01/G01/P01: **0/6, all UNRUN**.
- D00 environment discovery: UNRUN. The value of `__CF_USER_TEXT_ENCODING`
  remains unknown; no value was read, guessed or invented in this revision.
- START-POSITIVE and START-REFUSAL: UNRUN; D01–D04 fixture DATA controls: UNRUN.
- No owner/controller epoch began, no enrolled child was launched, and no
  attempt-01/raw receipt/main preseal/scratch directory exists. This is NOT a
  claim of zero preparatory OS processes: a read-only Node job-schema inspection
  and the source-authoring Node invocation occurred before HOLD; ordinary
  shell/Git/apply_patch administration also occurred outside any qualification.
- No measured all-owned process peak, enrolled duration/capture budget,
  owner PID/known-reap proof or successful cleanup experiment is claimed.
  Tool termination is observed; exact author PID was not captured.
- The source author's in-memory fixture construction and partial metadata
  assertions are not counted as completed versioned-fixture DATA qualification.
- No product execution/import, build, compiler, native oracle, private package,
  network, agent delegation, root config/export/AGENTS/dependency edit occurred.

Post-HOLD metadata confirms absence of FIXTURES-v5.json, REMAINING-v5.json,
INPUTS-v5.json, DISCOVERY-PRESEAL.json and attempt-01. The real Node and Git files
match the supplied SHA256s and modes; this post-failure observation is NOT
prelaunch or runtime qualification. POSTGUARDS.json records narrowly scoped
source hashes, frozen bindings and append-aware owned-scope membership; checks
of named foreign files do not detect new entries throughout foreign trees.
There are no raw streams to join: no raw membership receipt is manufactured.

## Preserved historical authority

Candidate `58be2d6c5706f3e90f01d48e695ecfd9daa52669` remains unchanged by this work.
S54 remains Poincare/root's separate adjudication. Preserve diagnosis
`915aee082e5aaa53abba7578b5ccbe11e679e4e7` and v4 evidence
`6585d17a90a9971ca2cc36dad16b41c505c16b9b`: startup HOLD0/6, transcribed-not-raw,
unknown platform value, unrun helper code. Original consumed
`42e2529034a1a39d7c23945c3bfb22b228df180f` remains HOLD27/70, peak>=3 violation,
43 UNRUN, 346/11/18/3 observed and 346/11/62/3 full obligations. No original
32+80 fixture, limits, failed expectation, worker or capture was modified.

## Draft handoff, not GO

PLAN.md/CALLGRAPH.md and the sealed source describe a single owner, separately
presealed discovery, early outer child capture, in-process administration and
five sequential proposed children. Those routes remain **unqualified**.
The source/preseal-first → one bounded qualification → evidence sequence was
not reached; only an explicitly labeled draft-source commit precedes this
failure-evidence commit. No successful preseal is substituted after the fact.

The unmaterialized proposal preserves the exact old43 descriptors and separately
plans new IDs: moved types5, limits18, adapters2, mutants18. Its additional
four-fixture tail is 3 layout jobs/12 rows; 11 auxiliary metadata/build/guard/
runtime-seal jobs are separately proposed, for57 children. These numbers are
draft design, not emitted/qualified fresh-job data or a new denominator of passes.
The exact future 43-job document and its tail/budget still require generation,
different review and explicit root GO after this blocker is adjudicated.

The four proposed fixtures remain authored code only: S62 canonical38-byte
permission diagnostic is not truncation proof; S64 allows wrapper acquisition
and proposes zero PULL plus intended writes/no extra effects (zero total FS
effects conflicts with the required added file and needs root clarification);
S71 records actual mode argument; S74 accepts only the existing exact98/92-byte
diagnostics and does not claim uncaptured timestamps prove branch cause.

Next authority needed: permission to distinguish frozen job IDs from backend
tokens in a separately reviewed authoring revision, preserving both exact
memberships and the failed source. Do not run the current author/owner or
silently fix this consumed preparation. The committed-runtime-seal barrier
remains; isolated Git metadata, even if later qualified, would not qualify real
repository commit machinery. No durable-file/handoff substitution was made.
