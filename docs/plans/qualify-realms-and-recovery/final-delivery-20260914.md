# qualify-realms-and-recovery — delivery and remaining blocker

**Qualification remains incomplete.** Uncaptured raw shared writes can still
produce 7 originally and 0 on recovery, including resumed effects [7,0] before a
later mismatch. [Exact current-source reproduction](shared-history-integrated-20260914.md).
The repairs below do not claim arbitrary live-realm interoperability, native weak
lifetime determinism or exactly-once external effects.

## Verified source and target

The three atomic fixes are:

| Local commit                               | Repair                                       | Verified remote delivery   | Scoped publication              |
| ------------------------------------------ | -------------------------------------------- | -------------------------- | ------------------------------- |
| `5ad2344edc13cd11508cb0b4cee1828c8b9e2c26` | RR-8 exported shared graph coverage          | Normal push/fetch; on main | SafeFS/SafeJS/Safe Bash 0.1.596 |
| `4e02e3fa84c2c6dc1437da63ddee717d63935657` | jobs-v9 host admission, metadata and symbols | Normal push/fetch; on main | All three 0.1.597               |
| `0bba68687af792727e8ae86d158b2999e8990193` | Bun shared native wrapper fallback           | Normal push/fetch; on main | All three 0.1.598               |

Both earlier fixes are verified ancestors of `0bba6868`. Delivery used isolated
main checkouts; the original checkout's divergent history, unrelated changes and
staged Safe Bash patch remain preserved. No force-push, hook bypass, co-author
addition, local publication or destructive rollback was used. No explicitly
associated issue number was supplied.

The compatibility target remains ECMA-262 edition 16 and ECMA-402 edition 12
(June 2025), Test262 `419d3e0a2273ba01a3bfcbec423f2801425b8e93`, and explicitly
tracked newer APIs including Temporal `e8cc03fc970a65a3359e8870e3b35e687ac94e55`.
Local full gates used Node 22.23.2 / ICU 78.2 / Darwin arm64. The additional Node 26
native-comparator gate used Node 26.8.2 / ICU 78.3. Cross-runtime receipts retain
all six Node versions, Bun 1.3.11's reported ICU 74.2, and Workerd 2026-09-01 (ICU
not exposed). No target, runtime support, allocation budget, assertion or timeout
was weakened.

## Qualification evidence

- All 156 supported transport, 100 rejection and 18 version-envelope matrix cells
  pass on integrated v9 source, with six genuine-v8 controls.
- Final combined SafeJS gate: **30,003 passed / zero failed / 47 skipped** in 1,384
  files. The main v9 integration also passed the complete root build/test/lint/
  installed-smoke route; the Bun increment passes its selected maintained build,
  package gate, scoped lint, 100 contracts and 71 harness/loader/smoke controls.
- The 47 skips remain visible: 33 filesystem reference gaps, 11 unavailable native
  Temporal comparisons, 2 unavailable native Math.f16round comparisons and one
  opt-in parser fuzz test. A supplementary Node 26 run passes all 86 selected
  controls, covering the 13 native comparisons without relabeling the original run.
- Built and independently installed SafeJS 0.1.598 each pass 70 shared graph cells
  across six Node versions and Bun. Installed metadata/admission checks pass 24
  Node/Bun cells; actual installed Workerd passes nine controls. SafeFS and Safe
  Bash each pass independent installed controls. The scoped consumer audit verifies
  **18 registry signatures / 12 attestations**.

The [v9 report](transport-delivery-20260914.md) maps 39 maintained test files to the
requested realm/source, closure, literal/template/intrinsic, dynamic eval,
class/private, suspended-frame, iterator, error/promise, Temporal/shared/weak,
malformed-record, version, allocation, rollback, cancellation and reconciliation
paths. [RR-8 TDD](rr8-repair-20260914.md), [Bun TDD and runtime evidence](bun-shared-wrapper-20260914.md)
and [portable installed QA](installed-artifact-qa-20260914.md) preserve exact
commands, failing controls, corrections, source hashes and observed results.

## Publication receipts

All scoped tarball SHA-512 values match registry integrity and provenance subjects;
attestations identify each corresponding repair commit and GitHub publishing run.
Metadata, attestations and tarballs propagated at different times. Retained 404/
ETARGET observations were retried; no green workflow alone was treated as proof
that a package was available.

| Source | Scoped workflow                                                                           | Schema workflow                                                                           | Root workflow / actual publication                                                                                                                                          |
| ------ | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RR-8   | [34832903400](https://github.com/poe-platform/poe-code/actions/runs/34832903400), success | [34832903317](https://github.com/poe-platform/poe-code/actions/runs/34832903317), success | [34832903636](https://github.com/poe-platform/poe-code/actions/runs/34832903636), success; poe-code 15.0.39 at 5ad2344e, independently installed and verified               |
| v9     | [34837374651](https://github.com/poe-platform/poe-code/actions/runs/34837374651), success | [34837374667](https://github.com/poe-platform/poe-code/actions/runs/34837374667), success | [34837374864](https://github.com/poe-platform/poe-code/actions/runs/34837374864), success but no publication: main advanced; successor ancestry verified                    |
| Bun    | [34838741989](https://github.com/poe-platform/poe-code/actions/runs/34838741989), success | [34838741967](https://github.com/poe-platform/poe-code/actions/runs/34838741967), success | [34838742171](https://github.com/poe-platform/poe-code/actions/runs/34838742171), success; poe-code 15.0.40 at 0bba6868, independently installed; contains both later fixes |

The root successor published **poe-code 15.0.40** at `0bba6868`. Downloaded
SHA-512, registry integrity, SLSA subject and publication commit/workflow agree.
Its installed public export passes 70 graph cells across six Node versions and
Bun, plus 24 Node/Bun metadata cells, legacy alias identity and CLI version.
The combined consumer verifies **213 registry signatures / 42 attestations**.
The installed raw-history witness still reproduces the acceptance blocker.
[Immutable package receipts](publication-receipts-20260914.json) record all eleven
package-version publications independently.

A mistyped manual CLI path (`build/cli.js`) failed before loading the package;
the package's installed `node_modules/.bin/poe-code --version` passed with 15.0.40.
This invocation error is not a product failure.

## Remaining recovery work

Raw shared-memory writes outside captured host operations need an enforced
ownership/history boundary or resumable-state design before effects execute.
The synchronous controls pass, but queued histories recover 0 instead of 7 and
can execute an effect with 0 before later mismatch rejection. The witness exits
zero to report observations; its semantic acceptance is **false**. Blanket shared
execution rejection, ordinary ArrayBuffer copies, weaker assertions and claims
of exactly-once effects are not acceptable substitutes. This task remains open.

If a future publication is partial or superseded, fetch and verify the successor
contains the repair, follow its required workflows, retry registry propagation,
and independently verify every affected artifact. Do not unpublish or roll back
without explicit authorization.
