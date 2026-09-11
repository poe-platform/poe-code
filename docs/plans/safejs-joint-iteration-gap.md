# Joint iteration gap

Built isolated candidate probe 5dd944 returned `["undefined","undefined"]`
for `[typeof Iterator.zip, typeof Iterator.zipKeyed]`. A bounded search of
SafeJS source, tests and plans found no corresponding implementation. The
probe used the already-built prototype candidate without changing its inputs.

Both methods appear in the current
[ECMAScript 2027 draft](https://tc39.es/ecma262/multipage/control-abstraction-objects.html#sec-iterator.zip).
Record this separately from published-2026 compatibility, without dropping it
from the broader JavaScript-completeness objective.

Required semantic coverage includes shortest, longest and strict modes;
ordered option access; iterator acquisition; padding; early closure and error
precedence; lazy advancement; and helper return behavior. Keyed results require
null prototypes, enumerable own string/symbol keys, and omission of undefined
input values. Primitive inputs must follow the specified rejection rules.

Implementation also needs guest-call dispatch, retained-state accounting,
budget enforcement, originating realm identities and snapshot/replay support.
Use existing iterator infrastructure where its semantics fit; do not substitute
eager arrays or a host-native-only adapter. Before runtime changes, establish
failing regressions with independent expected values and observable call traces.
Native availability alone is not the oracle for a recently finished proposal.

This is a validated missing capability, not an implementation or conformance
claim. The ongoing full-suite candidate remains unchanged.

## Implementation regressions

Concat is now committed independently as 2fa89c3c6. Joint iteration remains
absent on that base. Initial regression run 8096 failed all 22 cases for the
missing APIs, with no fixture parse failures. Coverage includes all three
modes, empty inputs, keyed string/symbol rows and null prototypes, padding,
metadata, invalid options, eager opening, early reverse closing and strict
mode's done-only check after the first input finishes. Negative controls also
require the callable to exist, so absent methods cannot falsely pass them.

Installed Node 26.4.0 also reports both methods as undefined (dcc574); it is not
a native oracle for these cases. Expected traces follow the current draft's
IteratorZip and
[IteratorCloseAll](https://tc39.es/ecma262/multipage/abstract-operations.html#sec-iteratorcloseall)
algorithms. Additional regressions cover acquisition-failure cleanup, first
close-error precedence, and bounded padding consumption/closing. Runtime and
snapshot implementation have not started; budget, realm and recovery coverage
remain required. No push or release is authorized.

Expanded regression run 60349 failed all 25 cases on the unchanged runtime,
including the three cleanup/padding additions. This establishes the red side
of implementation; it is not a passing conformance result.

## Runtime and recovery implementation, September 9

Revalidated the current worktree: session 65612 failed all 25 cases because
both methods were absent. Added joint state to the shared iterator helper and
implemented the two static methods using guest property/call dispatch, including
Proxy-aware keyed enumeration. The implementation covers eager acquisition,
lazy rows, reverse closing, strict done-only checks, longest padding and
null-prototype keyed output. Completion clears retained joint state.

The initial runtime run (36102) passed 46 zip/concat cases. Added a regression
for cleanup that throws: a close method must not be retried by the surrounding
error handler. Added Proxy enumeration coverage. Snapshot regressions (43421)
then produced six expected failures for missing format support, alongside 28
passes. Extended capture, validation and restore for mode, nullable exhausted
cursors, padding and string/symbol keys. The next run (53905) passed all 62
cases across four files.

Added public dump/run replay for both methods, reentrant next/return checks,
and next/done/value failure precedence. The broader focused run (73817) passed
207 tests across 15 iterator/snapshot/retained-root files. Scoped ESLint
(48436) passed. Maintained build (83751) passed all 23 declared build tasks and
four fresh-process native ESM checks. The built CLI passed on Node 18.18.2
(26175d). Screenshot 71426 was inspected and shows the expected longest pairs
and strict keyed rows:
`screenshots/node-packages-safe-js-dist-cli.js-tmp-safejs-joint-smoke.7HKEWg-joint.ajs.png`.

These checks ran on the mixed main worktree, not an isolated joint-only
candidate. No full package gate, isolated delivery qualification or general
JavaScript conformance is claimed. Before an atomic local commit, qualify an
isolated candidate and add direct SDK originating-realm and fatal-budget
coverage; review retained thrown values during cleanup and malformed symbol
key alias validation. The README now describes the implemented APIs. No push,
release or issue closure occurred; the release hold remains active.

## SDK and safety regressions

Session 29570 added direct SDK calls with foreign Proxy inputs, helper/row/result
realm checks after cleanup, fatal step-budget cleanup, retained first-close-error
accounting, and duplicate well-known symbol snapshot keys. Ten cases passed and
two failed: the retained-error size delta was zero instead of 200, and two heap
IDs for the same well-known symbol were accepted as distinct keys. Fixed both
reproduced defects: reverse closing now retains the original/first thrown value
while guest cleanup runs, and key validation canonicalizes well-known symbols.
Session 37077 passed all 45 cases in the three joint runtime/SDK/snapshot files.
The joint-only candidate will exclude the unrelated weak/prototype worktree
changes; its qualification is still pending.

A further borrowed-next SDK regression (57544) failed: the result wrapper had
the called next method's Object prototype as required, but the row inherited
the foreign next realm's Array prototype. IteratorZip runs its row creation in
the creation context. Joint state now retains that Array prototype explicitly,
and capture/validation/restore preserve it. Session 31619 passed all 46 joint
cases after the change. Added a snapshot check for the prototype's mutated
marker and shared alias, and kept malformed-field tests independent of the new
required prototype field. The first exported candidate was not validated and
will be refreshed before any build or test qualification.

The first refresh was still exporting when build 74400 started; it was
explicitly terminated and excluded from qualification. After export 98133
completed, all 1,337 candidate source/test/script/package blobs matched the
private index (f0b4a8). Fresh build 1664 then failed TypeScript on the new
prototype field's broad `object | null` lookup type; added the guest-object
type assertion at that boundary.

A row-allocation probe (52007) also showed zip returning two elements with an
array-length limit of one. Regression 45487 failed as expected, independently
of input-array limits. Added the row allocation check; SDK run 14496 passed
all six tests. Candidate lint 73267 is still evaluating its frozen, earlier
inputs. Refresh only after that process is terminal, then rerun qualification
for the corrected candidate. The consumer `toArray()` has a separately
validated analogous gap, recorded in
`docs/plans/safejs-iterator-consumer-array-budget.md`; it is not part of this
joint-iteration improvement.

## Isolated qualification

Earlier lint 73267 completed successfully before the candidate was refreshed.
The final candidate is `/tmp/safejs-joint-candidate.XgnEJm/candidate`, staged
through its private index against `2fa89c3c6`. It contains only the twelve
joint-iteration code/test/README/plan paths, excluding pending weak collections,
prototype-origin changes, the new consumer allocation fix, and user changes.

- Source fingerprint 750fd5: 1,337 matching source/test/script/package blobs.
- Maintained build 67024: all 23 tasks and four fresh native ESM imports passed.
- Scoped ESLint 82788: terminal success.
- Snapshot directory plus 32 related iterator/accounting files, session 95683:
  2,466 tests passed across 164 files in 84.59 seconds.
- Built CLI on Node 18.18.2 (9700f6): correct longest and strict keyed results.
- Screenshot 97513 was inspected:
  `screenshots/node-tmp-safejs-joint-candidate.XgnEJm-candidate-packages-safe-js-dist-cli.js-tmp-safejs-joint-smoke.7HKEWg-joint.ajs.png`.
- Post-build/test fingerprint: all 1,337 blobs matched; eight generated Intl
  copies matched the built artifacts; no unexpected source/test/script files.

This establishes the focused joint-iteration change, not a green full-package
gate or complete JavaScript conformance. Commit this improvement locally and
keep the release hold: no push, publication or issue closure is claimed.
