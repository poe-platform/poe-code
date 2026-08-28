# Independent actual review: noncollecting jq string length

**Scoped verdict: ACCEPT source74361026502d76b8c2b696f9c60e410ac9b78d95.**
This reviewer did not author the product repair. The precode holdouts from
`20351e9920f89cc2a07a98eb24ac062f42be78ad` run unchanged. No product file was
edited, no fixture expectation changed, and no author result is counted as
independent evidence. Review harness commit: `c6266254`.

## Chronology and source choice

August 28, 2026, UTC-05:

- Independent holdout freeze20351e99: **00:56:50**.
- Versioned permission-path runner correctionfed80614: 00:58:00; original
  worker/vectors unchanged. Original pre-body permission failure remains intact.
- Independent baseline evidencec05ea6ed: 01:01:15. Baseline collection remains
  detected / desired noncollection unmet; those captures were not rewritten.
- Author fixture freeze6db95e89, baseline evidenceae03ec31, source74361026
  (**01:12:14**), and candidate evidencef233a14b are separate author records.
- This actual independent run: **01:19:25.300–01:20:02.633**. It ran once and
  completed without setup or unexpected execution failure.

The reviewed build is explicitly the fixed **5137a74ec855a32d8a8860eb66b62eb44d11e290
269-file recipe plus only the exact candidate interpreter**. It is not an
ancestry claim or qualification of every file at candidate/current HEAD.
The source commit itself changes one file only. Independent byte comparison
proves replacement of exactly this arm, with all other interpreter bytes intact:

```text
else if (typeof input === "string") yield Array.from(input).length;
```

The replacement is a block-local numeric counter over `for...of`, followed by
one result yield. No new Budget call, guard, signal observation, await, scheduler
yield, API, import/export, helper or other branch. The emitted interpreter SHA256
changes from `42366cfd87db215b3ededa70c255fd8395d72706591360d503bd863f1ecb9d4c`
to `cc86b7c89e05046aa989c9828444f30907c2d67b00d587c73469108ac2057540`.

## Independent outcomes

| Check | Actual result |
| --- | --- |
| Unchanged direct semantics/one-step/pre-aborted reason groups | **37/37** |
| Unchanged trusted-host String iterator groups | **4/4** |
| Unchanged actual moved-public command/Shell/VFS groups | **19/19** |
| Tiny actual-interpreter noncollection requirement | **Pass** |
| Existing selected semantic/prototype/order regressions | **91/91** |
| Existing two selected resource regressions | **2/2** |
| Candidate, reverted and restored strict source builds | **3/3** |
| Actual moved-package strict consumer types | **Pass** |
| Injected wrong maxSteps type | **Exactly one TS2322**, exit2 |
| Changed module / changed manifest / outside-source fallback | **3/3 rejected**, exit1 |

The **60 unchanged observation groups** and **93 unchanged selected regressions**
are separate denominators. There are zero selected skips/cancellations. The same
one native semantic-oracle test and four nonselected resource tests remain
outside scope; no native jq/yq/reference execution or new oversized probe was
introduced. The selected resource suite retains its already-bounded 4096-result
case and boundary refusals. This is not a whole structured-suite/full-gate or
native-parity score.

String cases preserve code-point/iterator-element semantics for empty/ASCII,
astral, combining/ZWJ/modifier, and lone-surrogate internal inputs. Null, numeric
including NaN/infinity/negative zero/Decimal, object/array and Boolean-error
behavior stays unchanged. The direct first result fits maxSteps:1; the existing
entry tick and exact errno/falsy abort reasons are preserved. A trusted iterator
that aborts during its synchronous count still finishes without a newly added
signal observation, and its queued microtask still runs after the iteration.

## Actual package and load provenance

The supplied source archive was hash-authenticated and every one of its 269
regular entries independently compared with its exact Git blob (candidate
interpreter substituted only). No AGENTS or Git history is copied. The reviewer
then rebuilt those independently reconstructed files using authenticated tools.

Archive SHA256:
`9b9b7c8a7e4c117c2348dfcbc06be64f6dc569301182142122e806d8c7282625`.
Actual tested npm tarball SHA256:
`351e03ad72b0bd82bb16d97cc50ec80b136edeaf705ec1590b414cb4cdf8b82e`.
**All 845 packed files, including declarations/maps/package.json, equal the
fresh independent build.** This is stronger than trusting five author-listed
module hashes alone. The original tarball was installed offline with scripts,
audit and funding disabled into a unique test consumer, then physically moved
to another consumer. The old installed package path is confirmed absent.

The unchanged worker authenticates the complete package manifest before module
imports and checks the resolved public root against the moved package URL.
Actual loaded interpreter/limit/number/error/root URLs and hashes are recorded.
The read fence admits only the moved consumer, not original source/tools or the
live checkout. A deliberate import of the source build's dist/index.js receives
ERR_ACCESS_DENIED, not a missing-module or parser error. The independent strict
public consumer imports the same moved declarations; a wrong numeric option is
rejected with exactly one diagnostic rather than suppressing unknown errors.

Node22.22.2 SHA256:
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.
314 installed tool files are authenticated to the baseline tool inventory. The
actual npm CLI path/hash and every command argv/status are recorded. npm is used
only for the isolated offline test install, never as a product dependency.
No private checkout, ambient credential or external service is accessed.

## Real reversion control

The probe instruments only the exact tiny sentinel input to Array.from after
compile and authenticated module loading. It preserves unrelated calls and
restores the descriptor. The deliberate collecting control trips, the fixture
counter does not, and candidate execution returns the correct count without a
sentinel Array.from call. No memory/RSS sampling stands in for this assertion.

The reviewer then **restored the old arm in the actual candidate source copy**,
asserted full interpreter equality with the baseline bytes, and compiled again.
All 845 resulting package files equal the independently captured precode baseline
package. This is a real source reversion, not a fake JSON receipt, alternate
helper or altered assertion. New processes load the actual reverted module.

- Candidate loaded module `cc86b7…`: productCollected=false; authenticated
  noncollection assertion **exit0**.
- Reverted loaded module `42366c…`: productCollected=true; the same assertion
  **exit1**, specifically `actual bound interpreter must not collect the sentinel`.
  All 60 unchanged semantic/iterator/public groups still pass on the reversion,
  demonstrating why semantics alone do not discriminate this allocation repair.
- Candidate arm restored and rebuilt: module `cc86b7…` and the entire generated
  tree return to candidate hashes; another fresh-process assertion **exit0**.

`require-noncollecting.mjs` consumes the hash-bound raw receipt from the unchanged
worker and checks its expected manifest and loaded interpreter identity. The
failed reverted assertion is retained, not counted as a candidate failure or
quietly rebaselined. The reverted/restored packages are fresh rebuilt regular-file
packages; no separate mutant npm-tarball claim is made.

## Preservation and bounds

`attempt-01/REPORT.json` preserves all raw statuses/stdout/stderr, three loaded
package manifests, archive/build/tool bindings, 93-test TAP and exact mutant
outcomes. Separate allocation receipts preserve candidate/reverted/restored
marker observations. No child exited by a signal, scratch was removed, and
no owned process remains. Source/tools and generated candidate files are checked
before/after, including new entries; only declared generated dist is permitted
as an addition. Deliberate mutations are restored before the final census.
The real repository and supplied author archive/tarball are unchanged.

All precode files and original captures/seal remain byte-identical. The old root
`verify.mjs` was successfully executed before adding this explicit revision.
Its historical whole-directory census naturally does not admit new revision
files; it has not been weakened. This revision's verifier authenticates the old
sealed membership and permits only this named additional scope, rejecting other
unrecognized files/directories. It seals its own files separately. For an exact
old-directory replay use the old committed packet, not the augmented directory.

No RSS/heap bound, zero-allocation claim, untrusted-host sandbox, synchronous-loop
preemption guarantee, broader yq capability, root wiring or full-product release
acceptance follows. The verdict covers only the authorized noncollecting string
arm and its preserved semantics/accounting on this authenticated recipe.
