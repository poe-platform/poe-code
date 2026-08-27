# Independent release-readiness fixture freeze — pre-candidate

This owned sidecar fixes review expectations **before Curie's patch/source is
declared**. It does not fix gate code, execute a gate, qualify a candidate, or
reopen the exact-pack review. No live/future author code was inspected.

## Authority and chronology

- Immutable inspection boundary: `d5f068cd3649c09c6e4573645b64de505875adc3`,
  `tests/integration/full-gate-20260827/readiness-73/README.md`.
- Its readiness observation names source
  `c355751f36ca3fdbab8f888eaab30203c1bcd343`, tree
  `04d652efd8716b29877b6c928e4ed4c851babb55`. Neither is the next candidate.
- `boundary.json` records the full immutable refs, Git blob IDs and SHA256s;
  its timestamp is preparation time, not a claimed source freeze. Four exact
  pure helper modules and their dependency are retained as four files under
  `baseline/` (account, runtime coverage, inventory check, current profile).
  Only pure exported checks are called. No baseline driver is launched.
- Root accepts scoped exact package `3dc0ac26`, review based on `316b7efe`,
  unchanged 56 frozen checks plus four grep checks and authenticated assembly,
  pack and controls. The original frozen driver's omission of README remains
  a **distinct rejected admission**. The original eleven frozen files are not
  rerun or rewritten. Author prior **12/16, 61/63, 14/17** remain history, not
  first-pass success. Exact-pack reproducibility belongs to another worker.
- Candidate patch, source, package, approved native profile, per-path routes,
  and candidate cleanup manifest remain pending. This commit will freeze cases;
  root's later immutable declaration and source freeze must follow it. Do not
  fill in a guessed HEAD, infer acceptance from ancestry, or backdate a result.

## Fixed case matrix and independent inputs

`cases.json` fixes each ID, group and expected accept/reject before candidate.
`selfcheck.mjs` contains the corresponding concrete mutations and payloads.

| Group | Definitions | Required outcome boundary |
| --- | ---: | --- |
| Input inventory | 14 | Unchanged and legitimate postsetup baseline accept; add/remove/byte/type/mode/link changes reject |
| Native asset | 4 | Known inert fixture accepts; missing/wrong bytes and recorded rg mismatch reject |
| Classification | 10 | Explicit synthetic routes accept; omission, duplicate/invalid classes, unrouted consumers, tampered history/declarations/evidence reject |
| Negative diagnostics | 6 | Exact known TS2741 at (2,41) plus positive control accepts; wrong line/code/module/positive/exit rejects |
| Default names | 6 | Independent immutable 73-name fixture accepts; 70 or curl/SafeJS/expr/du substitution rejects |
| Canonical migrations | 4 | Exactly the two approved files/four assertions accept; missing, wrong or historical rewrite rejects |
| Cleanup source binding | 6 | Exact 244-entry readiness observation control accepts; missing/stale/swapped/revision/tree mutation rejects |
| Required runtime/TAP | 13 | Complete successful one-test control accepts; exit/timeout/signal/truncation/count/nonpass failures reject |
| Permission/dispatch | 8 | Positive plus specifically attributed denial accepts; fallback, ambient native and reporter-placement errors reject |
| Candidate parameters | 7 | Complete synthetic structure accepts; pending/mutable/missing/skipped structure rejects |

Total: **78 definitions**, plus one boundary-integrity test = **79 node:test
checks**. The classification omission definition additionally exercises **all
eleven exact paths**, not just one representative (ten extra assertions).
The eleven path/hash entries are individually frozen in `boundary.json` with
null classification, route and provenance. Scenario assignments are explicitly
synthetic; they are **not** declarations about those real consumer programs.

### Inventory boundary

The independent fixture walker uses lstat, records every directory/file/symlink
including dangling links, and does not follow symlinks. Both snapshots enumerate
the complete namespace, so additions (including empty directories) are detected.
Type controls include file-to-directory, directory-to-file, file-to-symlink and
symlink-to-file. File replacement with equal-size different bytes is tested.
Unsupported special input types fail fixture admission; no FIFO/native creation
is performed. Modes are recorded; inode/mtime/no-write-attempt guarantees are not
invented. An unchanged pre-existing symlink is allowed by this fixture profile.

Setup may legitimately create declared build/dependency artifacts **before**
the immutable execution baseline. The postsetup positive control includes such
an artifact, captures baseline, then executes without changes. Future candidate
review must distinguish Git archive admission from this postsetup baseline.
Scratch/output paths must be explicit and outside the immutable input root or
an exact root-approved phase contract, never a blanket ignored source subtree.
Snapshot comparison is not a race/ABA or identical-content-write detector.

### Native identity

Accepted expected rg SHA256 from the immutable boundary:
`4298efd414836892c913b2e87401d62fdd7c6ec4026d9bad8e3fab10557e411f`.
Recorded observed SHA256:
`5d24e1af7efa7811e03df5555eeaa984bc8bd98ab42a5d49ecf30f163273e6c7`.
**48/49 admitted in that observation; the actual 49th rg identity mismatch is
unchanged and unresolved here.** No present-host rg read/hash/execution occurred.
The inert positive fixture is not a production binary and authenticates no
installed oracle. Restore an authenticated old asset or obtain root's explicit,
justified source/profile binding before admitting any different identity.
The observed hash is never automatically made expected. Additional expr/du
staging/profiles remain subject to the final root scope, not assumed covered by
the inherited 49. No native behavioral execution occurs in these fixtures.

### Classification, counts and cleanup

Use the existing `verifyInventory(inventory, tracked, currentPaths,
negativePaths, read)` interface where possible. Its accepted categories are
`current`, `negative-types`, `declaration`, `frozen-evidence`, `frozen-oracle`.
Current positive inputs need exact same-package compile/runtime routes. Negative
inputs need exact diagnostics and a corresponding passing positive; generic
nonzero exit or missing-module TS2307 is not success. Historical inputs stay
authenticated evidence, never current passes or broadly excluded input trees.
Candidate mappings for each of the eleven are pending; none is silently inferred
from a filename. Hashing these paths did not establish their runtime semantics.

Only `tests/commands/split/integration.test.ts` assertions at 39/45 and
`tests/commands/stream-format-author-stress/contracts.test.ts` at 19/26 migrate
70 to 73 (descriptive titles may follow). This means **two files, four numeric
assertions**, not an unrestricted replacement of historical 70/71. The 73 names
come from immutable evidence, not a product call or candidate result. Curl and
SafeJS remain optional, expr/du nondefault. Migration fixtures check a proposed
change summary; a later review must inspect actual patch bytes, not trust it.

The cleanup control binds the actual readiness envelope's format, source
revision, tree and every path/hash. Its same-count swapped-path/stale-hash cases
demonstrate why 244 alone is insufficient. Candidate 244 must be derived and
authenticated against the later exact source and root-approved manifest:
`VIRTUAL_BASH_PUBLIC_CLEANUP_EXPECTED` and
`VIRTUAL_BASH_PUBLIC_CLEANUP_COMMIT` must agree. **No candidate244 validation is
claimed.** Old220 and the readiness244 remain distinct historical observations.

### Runtime/permission boundary, not a new sandbox

Existing immutable `account` and `validateRuntimeResults` exports check the
synthetic TAP controls. Mandatory consumer groups require finite positive exact
counts, complete reconciled output, and zero fail/cancelled/skipped/todo. The
whole-gate accountant separately preserves optional skips/known failures; these
mandatory-consumer fixtures do **not** invent a universal zero-skip reporting
policy or silently waive diagnostic-gate failures. No stricter TAP header/plan
grammar than the inspected gate is asserted.

Transport and permission payload checks model inspected preconditions:
normal clean successful execution, real positive control, status1 and
ERR_ACCESS_DENIED/FileSystemRead with the expected resource, same-package types
without live source/dist fallback, and `--test-reporter=tap` before the input.
The ambient-native fixture means **no undeclared ambient capability added to
the guarded consumer**, not a ban on separately authenticated native oracle
work. These synthetic receipts prove only machinery behavior, not actual
permission enforcement, process supervision, child identity or a host sandbox.
Later qualification must preserve the actual Node24 profile/guard, direct/PATH
child identity, forbidden-read probes, source integrity and expected-negative
attribution; unknown flags are never denial evidence.

## Candidate handoff and future adapter

`candidate-template.json` intentionally fails structural admission today.
`candidateParameters` requires full patch/source/tree/freeze Git IDs, root
declaration, gate path/hash, distinct manifest/tarball hashes, native identities
and source provenance, per-path classification/route/diagnostic bindings, exact
244 source-manifest entries, runtime/guard identity and every frozen case ID.
No skipped-case option or mutable HEAD default exists. This is a small parameter
contract, **not an authenticator**: syntactically valid SHA strings do not prove
root approval, commit content, archive integrity, package identity or chronology.
The synthetic complete parameter control is explicitly not an authorized input.

When root supplies exact commits, authenticate all declared bytes from those
Git objects and artifacts first. Verify this freeze's commit/hash membership and
approval chronology; source may be a root-authorized assembly, never an overlay
of live product files. Preserve author-owned failures and all case IDs. Missing
APIs/bindings are pending or blocked, not skipped/passed cases.

Existing pure exported inventory/runtime/accounting functions are adapter-ready;
the mirrored immutable originals demonstrate their exact interface. Native
`assessNative` lives in `preflight-repair/preflight.mjs`; the current successor
driver's `verifySource` is closure-local, and the old entrypoint remains bound
to b494/8670. **Do not launch or import either driver to get a convenient helper.**
Once the successor API is supplied, call its actual exported snapshot/check
helpers on these fixture trees, or request a bounded subprocess adapter explicitly
from root. Do not substitute the independent walker for author code and claim
implementation acceptance. No speculative future gate adapter is implemented.

## Reproduce only this sidecar

From this directory, with the local Node binary and no installs/builds:

```
node record.mjs --capture selfcheck-02
node record.mjs --verify selfcheck-02
```

Choose a fresh output name; existing evidence is never overwritten. Capture runs
only syntax checks and this small fixture selfcheck, recording exact commands,
stdout, stderr, exit/signal, Node identity, fixture inventory and artifact hashes.
Replay uses only the local frozen helpers and regular owned temporary directories,
removed after each case. No product, canonical, external, native or whole-gate
execution is performed. Evidence directories are separate output, not candidate
input exclusions. The committed receipt authenticates this freeze's selfchecks;
its enclosing Git commit authenticates the receipt itself.

`freeze-baseline.mjs` is a one-shot immutable extraction recipe (Git reads only,
exclusive output creation). Do not rerun it over committed files: it will refuse.
Source data can be audited using the explicit revision/path/blob/hash entries.
