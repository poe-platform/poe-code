# Review handoff: `|&` and `&>` author candidate

August29,2026. **Author-only; independent source/fixture/runtime review required.**
No native Bash oracle or the40-case baseline was executed or changed.

## Exact product binding

- Production commit: `1e9b83d73ca6efcf84e4cb0a0b20d81f71da237e`.
- Baseline: selected public80 `c83f352f057c64917f219eb938f54aa42cdab829`, not HEAD.
- New derived tree: `ed0e0d09cf71bed7f4aee075750b60a30df4ef52`.
- SOURCE.json SHA256: `d181f7d3b5acfcb5521dd5cc26be0aa4f2ac15b3fed1df4b8c729f25b5e34b17`.
-292 selected inputs, exactly3 changed source blobs, all292 rehashed after execution.
  Tree witnesses authenticate the derived composition; no claim it is a published Git object.
- Full950-member package: `e0e63b0319f0b7b77e68a6e6284021bd747c60ce9f93291a5090048fa835e296`,
  864322 bytes. Actual production build, npm offline pack/install (scripts disabled),
  physical move and full member comparisons. Default80, exports, package manifest,
  dependencies and all other product source remain the selected baseline bytes.

| Source path | SHA256 |
| --- | --- |
| src/shell/parser.ts | 4cf3fd977e1a24c8c1d469d3c5d9cc4946e84cf4b17705ab8fc99e29ca43d40e |
| src/shell/runtime.ts | 05f7015213faf030ef8a0d87d273c9d30e7ff69489b1f3bf0ec5bb7a5645c11d |
| src/shell/display.ts | 293c7d058c5d959134334ba432ad4baa906a3b99608b38140d82887dbebfd6f8 |

Parser appends an implicit ordinary2>&1 at the end of the left command's redirect
list for `|&`; display recognizes the internal optional marker. Runtime `&>` opens
one existing output writer and assigns both descriptors to it. Existing reference
cleanup, budgets and ordered file writes are unchanged. No separate internal type
file, shared contract, new limits, broad AST redesign or default/API wiring.
`&`, `&>>`, dynamic descriptors/exec, strict clusters, nounset and `[[ ]]` stay out
of scope. No semantic compatibility or indistinguishability claim from these edits.

## One actual bounded run, including failures

Preseal `f883b8cf`; outer launcher `a68c2600`. Exact executable:
`/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`, SHA5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011.
Original invocation was `node tests/compatibility/bash-redirection-author-20260829/launch.mjs --run`
using that absolute Node. **Do not rerun it as an inherited grant.**

| Cohort | Source-build | Installed | Physically moved |
| --- | --- | --- | --- |
| New36 literal +12 boundary rows |22/48;26fail|22/48;26fail|22/48;26fail|
| Unchanged selected Git-public |45/45|45/45|45/45|
| Unchanged apply-public |28/28|28/28|28/28|
| Unchanged arrays |12/12|12/12|12/12|
| Unchanged selected coherence |18/18|18/18|18/18|
| Strict public consumer |pass|pass|pass|
| Negative type consumer |6 exact diagnostics|6 exact diagnostics|6 exact diagnostics|

No skips in these selected cohorts; no full505 shell suite, native or whole-product
gate was run. Build passes; six type groups pass,18 expected negative diagnostics
remain negative controls, not runtime cases. Main runtime totals375pass/78fail
across453 layout-case executions are **author raw results**, not a parity score.

Three loaded compiled mutations are detected by intended early byte assertions.
Restored rows: R01 passes; R03/R11 still fail the original directory-entry census.
Do not call all restores passing. Two loader-binding negatives reject missing or
changed candidate members. Separate compiled instrumentation observes one file
reference release before public settlement and exact OE file bytes; no native FD,
post-dispose counter or physical-memory proof is claimed.

New passing boundary rows include raw binary output, one initial file open,
pre/in-flight caller reason identity, held stdout backpressure, required file
completion after downstream head0, output quota failure and owned Real-file
effects. C07 checks equivalence with existing numeric-redirection sink-fault
mapping, not a new promise that every ordinary sink fault publicly rejects.

## Fixture-v2: exact issue, not silent pass promotion

Both failing assertion sites assumed readdir returns strings. The contract and
observations return `{name,type}` entries. All26 failures/layout plus the two
restored failures are listed with complete stacks in results-v1/SUMMARY.json.
The25 table cases fail **before** subsequent file-content/counter assertions;
those assertions are unexecuted, not implicitly successful.

`redirections-v2.mjs` and FIXTURE-v2.json correct only two assertion lines with
explicit file-entry expectations and byte-name ordering. Inverse patch restores
every original byte; all scripts, expected streams/status/content and case IDs
remain identical. Original SHA9117a41af3f4f9b065e57072b3c21b120212ad0a8f39dd5e268e47caa785f397;
v2 SHA3e11ac513a8fd1bec4a28f8c22e9f4d608ba49bb519427e12fe30f1b460be2cc.
**V2 execution count0. Product tree/package unchanged.** Different reviewer must
approve the delta then replay the original48 identities under an explicit new
fixture binding. All24 author loader admissions were consumed, so no extra author
runtime/retry was used to turn this score green.

## Resources, provenance and limitations

Actual inner duration86.910s; outer88.628s.34 direct children,24 implicit loader
reservations,0 RegexWorkers; all direct children closed naturally, no TERM/KILL,
no recorded cleanup failure. The outer owner/runner and source-data publication
helpers are separate from that58 inner-admission count. No global descendant
census, arbitrary-host cleanup or hard preemption claim. Serialized runtime work
used main/loader, not arbitrary Worker targets. The published records include
23 load-trace files; the missing-binding negative need not load a product module.

Raw child capture3,044,641bytes; retained inner scratch70,603,004bytes before
publication. Publication captures9,747,371bytes into171 records, compressed
4,263,770bytes. These are storage/capture accounting, not RSS. The full package,
member list, emitted bindings, type resolution, traces, helper correction failures
and all raw assertion failures are preserved in results-v1/RAW.json.gz.base64.
Original temporary roots remain retained, not scrubbed:

- `/tmp/redirection-author-5TPGGF`
- `/tmp/bash-redirection-unit1-launch-nyjrUG`
- preparation root in PREPARATION-ROOT.json

The initial source helpers had a wrong repository-depth calculation and exited1
before product execution; v2 source-helper correction and original stacks remain.
No instruction text was materialized in runtime inputs; no private engine, real
network, native Bash/comparator or foreign-source overlay was used. Foreign Node
work is not part of the selected composition. Safety/capture/retirement guard
failure did not occur; ordinary assertion failures were aggregated as authorized.

## Independent reviewer work

1. Authenticate exact baseline+three source blobs and full950 package; review
   lowering order, shared writer, display and unchanged ordinary redirect behavior.
2. Inspect the two v2 fixture corrections independently, including membership/type
   assertions and the previously unreachable file-content checks.
3. Replay48 unchanged identities using approved v2, all three meaningful mutants
   and exact restored runs; retain original22/48 and1/3 restore evidence.
4. Add independently chosen redirection/closure/error neighbors. Native comparisons
   remain Faraday's separately authorized fixed40-case baseline/candidate protocol.
5. No source/root acceptance, native parity, default expansion or new implementation
   unit is implied by this author handoff.
