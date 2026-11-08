# B1 PUBLIC15 final binding: HOLD on new publication recipe

Date2026-08-29. This review does not revoke Poincare's accepted finite runtime
preexecution review, execute an attempt, or establish a product failure.

## Accepted binding checks

- Candidate `bd0f227d081829512bafc2936f0b33632e02890b` unchanged.
- BINDING4265 bytes, SHA256
  `adce87b6432ac4c80b84bdf13a225e1b9b0771a398740866734b70476610c97f`.
- Runtime PRESEAL17692 bytes, SHA256
  `007887fff41f65481ecf7a4fe4ab68db2aa1a5c67d4782a30c5bf764d84f0fbc`.
- Prior review receipt SHA256
  `12c8f7e03af23977ccf5015a902fe04956681a26c89f59165409d606fc0578c2`,
  commit `ebf511e84bdb7d6fb0b11bca05310710c56967b9`, matches exactly.
- Package930368 bytes freshly stream-authenticated against
  `2fe071e2bfac5ef5c81dc7e475e059091f6add65cd7411dfcfbf0ce7f51f2eca`;
  no inflation/import/install.45 runtime input files/catalogs and all four new
  publication-file bindings authenticated. This does not repeat the earlier
  investigation of1117 origins/872 relative edges/three computed imports, nor
  independently rescore309 sources/1012 emissions/2274 tool files+12 links.
- Exact runtime command, cwd and login:false agree with the prior receipt.
  New publication captures are additive; original two launch slots and work
  root are unchanged. All five paths were freshly absent before/after controls.
- The new actual-publication module is distinct from preparation publication;
  its direct-entry guard requires `--publish` and six binding/authorization
  arguments. Pure import did not invoke that route. External source admission
  must authenticate publicationFiles before import; its later self-check is
  not initial execution authority.

## Actual review controls

Exactly one PURE helper replayed unchanged P01–P08: **8/8 PASS**. Only the
CONTROL-RESULTS output path was relocated into this owned namespace to avoid
rewriting the author's immutable evidence. It imported the authenticated pure
publication exports, not product/engine/Worker code. Synchronous child PID83190
returned status0/no signal,28 stdout bytes,0 stderr. Six local postguards passed.
No actual publisher, Git publication routine, owner, installation, compiler,
runtime case or Worker was executed by these controls.

The independent preseal SHA256 is
`c1fb98229f924c57da58184a3abe1d89af40695633c015810658adf370b2963f`.
Raw records: prepare.jsonl, run.jsonl, pure.stdout, pure.stderr,
CONTROL-RESULTS.json and POSTGUARDS.json. No injected OS/FD fault or actual
aggregate-budget boundary was exercised. Source findings below are not extra
test passes or empirical loss observations.

## F01 — aggregate publication resource binding incomplete

In new `actual-publication.mjs`, `inventory()` bounds only binding.workRoot
to768MiB. Evidence is then created separately under the repository's
`stage-b1-final-binding/actual-evidence`, outside that inventory. `copy()` bounds
its raw-copy subtotal to64MiB. `write()` generates WORK-INVENTORY,
OBSERVATIONS and PUBLICATION metadata without charging that subtotal; the live
publication stdout/stderr and external Git receipt are also not charged there.
Git output is separately buffered up to1MiB per invocation, not admitted against
the task's remaining combined capture allowance.

Thus the code supplies scoped raw-copy/work-root checks, not the declared
64MiB capture/768MiB **task** bound including publication. P01–P08 do not close
this gap. No actual overrun or lost byte is claimed.

Required repair or explicit ROOT policy decision: pre-admit a finite publication
reservation within the unchanged task bounds, account generated metadata/live
captures/out-of-work evidence, and stop before writes that exceed it. Do not
silently reinterpret a task cap as a per-store/per-phase cap or enlarge it.

## F02 — unsuccessful partial-matrix publication is not provided

If RESULT.json exists but its aggregate is incomplete, `publish()` invokes
`matrix(result.aggregate)`, which rejects anything except three complete
five-row layouts. That happens after raw copies but before OBSERVATIONS.json,
the unchanged second inventory, PUBLICATION.json and the evidence-only commit.
P06 itself confirms refusal of an incomplete layout matrix; this is not a new
actual attempt. A missing RESULT follows a different null/empty-row path.

This is fail-closed, not false semantic credit. However, it does not provide the
advertised completed raw-outcome/evidence-commit route for an unsuccessful
attempt containing a partial RESULT. Raw partial files survive; a final receipt
does not. Either explicitly qualify that limitation for ROOT or add a versioned
partial-outcome branch that retains raw identities/counts and marks completeness
false without weakening successful-matrix checks. No expectation changes or
author-source edits were made here.

## Fixed authority, clock and role requirements

Issued12:58:33.833Z, latest start13:18:33.833Z, expires13:48:33.833Z on August29.
These ISO UTC fields alone govern authority. The ROOT-qualified human
08:04:57/58 CDT labels convert to13:04:57/58 UTC; they do not change this window.
An attempt needs the full1800 seconds remaining. Expiration means STOP, not an
extension or another grant inferred from this review. Absence observations are
not reusable launch authority.

Proposed known roles:32 maximum,peak3; four sequential supervised children:
offline-install, workflow-source-built, workflow-installed,
workflow-physically-moved. Up to20 prepublication roles include fresh
metadata/admission and launch; publication reserves5 shell/Node/Git roles;
seven remaining slots are contingency, not measured starts or retry authority.
The authorization's measured knownStartsBeforePublication must be7..27 so its
declared +5 stays≤32. This is known-role accounting, not a universal PID census.

Fifteen calls are C10/C11/C15/C16/C18 across three layouts. Guest Workers≤5 per
layout,≤15 total,≤5 live; Regex0; asynchronous loader threads0. Three main and
at most15 guest synchronous hook entries are not thread counts or actual nested
load proof. Inclusive1800s=1620active+180publication/cleanup; install120,
layout300,case30,cleanup5 seconds. Initial host/zsh startup remains trusted
outside capture. The accepted finite PUBLIC96/98 source closure is not new
actual authority or full coherent acceptance.

Runtime command (NOT authorized by this HOLD):

```sh
B1_ROOT_GO=ROOT_B1_PUBLIC15_EXPLICIT_FRESH_AUTHORIZATION /bin/zsh tests/integration/agent-bash-coherent-author-20260829/stage-b1-r2/launch.sh tests/integration/agent-bash-coherent-author-20260829/stage-b1-r2/PRESEAL.json 007887fff41f65481ecf7a4fe4ab68db2aa1a5c67d4782a30c5bf764d84f0fbc 17692
```

Repo cwd `/Users/kjopek/Workspace/safe-bash`, login:false. Subsequent actual
publication requires publication.sh with BINDING file/hash/4265 and a newly
authenticated authorization file/hash/size containing action
ROOT_B1_PUBLIC15_ACTUAL, fresh ROOT message, bindingSha256, startedUTC and measured
knownStartsBeforePublication. An evidence-only publication commit or this
review commit is not a runtime grant. Its final Git receipt is intentionally
outside the committed evidence to avoid circular hashing.

All older HOLDs and observations remain unchanged. B2's672 retained calls,
types/mutants and50 Unit2 rows/layout remain pending separately. This review
adds no actual B1 results and does not activate the campaign.
