# Independent baseline handoff — August 27, 2026

**Frozen corpus and archived-source baseline only; not candidate acceptance.**
The source author is a different worker. No production, historical test, root
configuration, private package, ownedOutput or immutable8670 file was changed.

## Freeze and execution chronology

- Original expectations frozen at **14:46:16.685 UTC**, committed as
  `5339b1e75ecda072adffed689da21943235b9192` before source edits.
- The first baseline finished at **14:46:53.382 UTC**. Its endpoint still records
  no runtime source edit. All 30 product children were unavailable because of
  the reviewer's `/tmp` versus `/private/tmp` loader-root defect. Preserve its
  raw 0/30 assertion score and **0/30 available observations** separately.
- The disclosed setup-only v2 freeze is
  `dce6e3824d6de6d03490a531cf2bc7d2d279bb8c`, sealed at **14:48:31.872 UTC**.
  By then live runtime edits existed. They were not inspected, loaded or overlaid.
- The corrected baseline ran **14:48:54.295–14:49:11.868 UTC** against the same
  prepatch committed source `6fce94f8716f1b7a8e26af78ef8cb33594ec83cc`.
  Therefore a useful product baseline was obtained after source work began;
  do not claim otherwise. Original inputs and expectations are byte-identical.

## Counts and qualifications

Exactly **30 distinct cases**: 20 shebang semantics, four direct-env controls,
six host contracts. No extra case variants, discarded slots or corpus expansion.

| Corrected archived baseline | Result |
| --- | ---: |
| Structured observations | 30/30 |
| Raw frozen assertion passes | 7/30 |
| Raw failures | 23/30 |
| Shebang assertions | 2/20 (existing binding/refusal controls only) |
| Direct-env assertions | 4/4 |
| Host assertions | 1/6 raw, **0/6 evidentially accepted** |
| Qualified passes | **6/30**; 23 failures and one non-proving raw pass |
| Strict primary native tuple matches | 3/23 available references |
| Actual Darwin kernel attempts | 20, including one launch error |

The one raw host pass (`h06`) is **not evidence of the intended nested output
budget behavior**. Its frozen assertion checks the typed output-limit exception
but lacks an execution witness: the baseline spends that budget on its refusal
diagnostic before entering the nested script. Observations contain only the
outer script dispatch. The expected nested three-byte output was never reached.
This reviewer's under-specified executable assertion remains frozen and its
raw result remains intact, but it receives no acceptance credit. A future
reviewer must independently establish the intended route before crediting this
row; do not report raw 30/30 alone as acceptance or silently repair this fixture.

Two cwd rows (`s12`, `d04`) preserve native stdout using physical
`/private/tmp/...` versus the virtual namespace's literal `/tmp/...`. These are
**fixture namespace-spelling limitations**, not demonstrated product cwd bugs.
No output normalization or oracle substitution is applied. Their raw strict
native losses remain. The reference statuses and effects match all 23 frozen
normative rows; stdout matches 21/23. Four native diagnostic strings differ from
the predeclared virtual cause-specific policies; they remain strict losses, not
GNU-equivalent diagnostics. Environment ordering is not tested.

The Linux target is the explicit one-optional-argument argv model executed by
authenticated GNU env 9.7 on **Darwin**, with GNU Bash 5.3. A Linux kernel/runtime
was not available or executed. Actual Darwin `/usr/bin/env` kernel captures are
separate and never replace a failing primary model result. Native CLI controls
and modeled shebang references have separate profile labels. All binaries match
the historical authenticated hashes; no download/install occurred.

## Integrity and cleanup

All 225 selected committed source/build inputs are Git-blob and SHA256 verified.
The complete public source archive is compiled with existing TypeScript; each
of 30 plain-Node product children imports its compiled public index. **5,220
actual JS loads** match emitted hashes. Source, dist, original inputs, compiler/
dev files and native binaries remain stable. Native process/fetch denial hooks
record zero attempts in all 30 returned records. These are scoped hooks, not a
sandbox for arbitrary host JavaScript.

Both runs' 76 owned child groups are recorded absent after cleanup. Both unique
scratch roots are removed; no watchdog, waiting worker or dormant process remains.
Captured outputs/effects, failures, versions, input/source/oracle hashes and
live-tree qualifications are retained. Broad gates and competing suites were
not run. The read-only audit does not execute product or native commands.

Corpus SHA256:
`9b7afcf1565f3262101d7c65886b9ede259c3260f60e87d1ea4eed6aa4a1dfe4`

Versioned seal SHA256:
`57ca1c7b58421b37d21238c073ab92a445d2b9b03b47fe1538ab98d00db26e91`

Replay unchanged cases in a **new reviewer invocation**, against a committed
candidate, with a fresh output basename:

`node tests/shell-stress/env-shebang-integration-review/run-v2.mjs capture CANDIDATE_COMMIT NEW_OUTPUT_NAME`

Read-only baseline audit:

`node tests/shell-stress/env-shebang-integration-review/audit.mjs`

Dependencies: existing Node 22.22.2, TypeScript 5.9.3/dev type files, Git/tar,
authenticated existing GNU env/Bash and Apple env. The seal lists exact paths
and hashes. Missing native tools mean unavailable references, never fake passes.
Keep hidden case details with independent reviewers; root/author handoff should
contain only categories, commits/hashes, aggregate counts and runner prerequisites.
