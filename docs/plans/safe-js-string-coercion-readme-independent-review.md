# Explicit String README independent review

## Static-phase disposition

August 30, 2026. Aquinas independently reviews Curie's release-gated README
packet. **HOLD: one receiver-wording correction plus pending source/example/release
prerequisites.** Preservation and preimage checks pass. No runtime failure is
claimed, no author document is edited, and no source correction is requested.
This report is separate from the previously published released-value review.

Author manifest:
`/Users/kjopek/Workspace/poe-code-safe-js-string-readme-author/out/safe-js-string-readme/release-gated-candidate/manifest.json`,
SHA256 `b31482e47993053dafbefe982ba38c1d13a2071d318521809b38c6aa9057d447`.
The exact author base is `420233dc9af5977bee2cec5688cfa58bdd55ab40`.
Author HEAD/origin-main and read-only Git preimage checks match that pin; no
later remote tip or source-runtime equivalence is inferred. Own review HEAD
remains historical `8bdd30a7c804e646fdf2c569bc6bdabd408f301c`.

## Exact document identities

The prospective packet has three paths, but is not approved for publication:

- `packages/safe-js/README.md`: present preimage, 49,379 bytes, SHA256
  `afab33547472dcde6209331a9311179c2b20c8d0594f80c59a3f245d79f1f152`;
  frozen author postimage, 50,356 bytes, SHA256
  `5d06e7da79a1208a6a91bd4390ecb8d6df1666584571de4b5bd93635489df7da`.
- `docs/plans/safe-js-string-coercion-readme-release-handoff.md`: absent at
  the base; frozen author postimage, 8,352 bytes, SHA256
  `e4c9323263db5cfed3ecf6eea8d67e483c0c1492e41b719a85e2aa4bb7311081`.
- `docs/plans/safe-js-string-coercion-readme-independent-review.md`: absent
  at the base; this unique reviewer report, identified in the new manifest.

Both author postimages, their README preimage and full patch match the supplied
manifest. The prior author formatting warning remains in that manifest; it is
not silently erased. All previous published reviews and frozen HOLD/collision
capsules remain untouched.

## Preservation and scope checks

Independent reconstruction changes exactly two regions: the String built-in
bullet and former String(Error) paragraph, now two explicit-conversion paragraphs.
Replacing those two regions in the exact current preimage produces the complete
author postimage byte-for-byte. Every other byte is preserved. All eight fenced
examples remain identical, with no new fence; the three prior Float32, locale
and branded-Error inline examples remain literal matches.

This preserves browser/SafeFS/canonical names, host-operation policy and native
error-identity guidance, Map/Set and Array restrictions, and existing sticky-y
and binary-in statements. Those unchanged upstream statements are not new
claims or runtime findings from this review.

The proposed support is explicitly `String(value)`, not universal implicit
coercion. The draft distinguishes ordinary defaults, own guest hook ordering,
nonprimitive fallback, thrown-error propagation, array/admitted Float32 defaults
and branded Error formatting. It does not add implicit object addition, O08
source-callable own writes, symbols/prototype/accessor hooks, boxed String,
native-prototype parity or repair of old captures. Opaque host functions are
not presented as a conversion-hook execution path. Passive copying/digesting/
checkpointing are distinguished from reevaluating explicit source calls during
replay, rather than promising that all replay avoids hooks.

Historical scope evidence is authenticated, not reexecuted or promoted to a
current final source approval. In particular, the retained helper SHA256
`6ece85e437ea1b6de984c700220593414ff8660c74cff56559742587de120974`
uses own data descriptors, tries `toString` before `valueOf`, invokes admitted
closures through the interpreter context, budgets recursive conversion and
rejects exhausted primitive conversion. The historical review identity
`a29fb51c8f057c19d722e39a588d9b409f6d0d58c173b774e002f02de0341ddc`
is scope evidence only. The light-refresh manifest is expressly not the final
source seal. The abbreviated `da5bc...` supplied by root is not expanded into an
invented full identity.

The author attributes a prior actual 12.0.11 scoped prototype PASS to root. This
review neither revalidates that receipt nor revives an old OPEN disposition as
current; it also does not broaden that scoped result to old-capture repair.

## Finding: arrow receiver wording

**`STRING-README-ARROW-THIS-QUALIFICATION` — OPEN, documentation correction.**

At `packages/safe-js/README.md:286`, the draft says “unbound hooks receive the
converted object as `this`, while bound hooks retain their binding.” The same
unqualified receiver statement appears in
`docs/plans/safe-js-string-coercion-readme-release-handoff.md:74`.

That wording also encompasses unbound arrow hooks, whose `this` is lexical.
At the pinned current base, `packages/safe-js/src/interp/async.ts:339` creates
the closure scope and declares the passed receiver only when the node is not
an `ArrowFunctionExpression` (lines 346–347). The current file's Git blob is
`5ee4324703a574e9e81aab65151949edd0b0b9f0`, SHA256
`fc4231ca5f6d03af845c9b19127579d3564bf9cc8ae418d499bac6b8d39ae6cc`.
The bounded source excerpt is retained. The conversion helper's receiver
argument does not override the interpreter's lexical-arrow semantics.

Requested narrow author wording, in both places:

> Ordinary unbound hooks receive the converted object as `this`; arrow hooks
> retain lexical `this`, and bound ordinary hooks retain their binding.

Equivalent precise wording is acceptable. This does not request a new feature,
runtime test or production change. The two proposed examples use ordinary
objects/method syntax and remain unchanged. No arrow witness is executed during
this static phase, and no implementation failure is inferred.

## Exact example and release prerequisites

The two immutable example selectors and complete expected strings are:

- `README-STRING-ORDINARY`: `return String({ value: 1 });` returns
  `"[object Object]"`; 28 source bytes, SHA256
  `bcd03b28a7f905d30709524f63e73f6c571789fde4b19feb706705544d710756`.
- `README-STRING-GUEST-HOOK`:
  `return String({ toString() { return "custom"; } });` returns `"custom"`;
  51 source bytes, SHA256
  `61674dbe263bf5d80a5cbbbbcfee5cb33fb89d0baa862283dff12b23aaaa60c8`.

Source bytes/hashes and literal README expressions are checked statically.
**No native/public result for these new selectors is certified yet.** Noether's
forthcoming receipt must preserve the exact sources and complete native/public
values, resolved `ok: true` versus rejection, command and artifact identities.
A local package must remain labeled local. These two examples do not certify
the entire hook/budget/replay feature matrix; that is separate source-review work.

Before final documentation approval and publication:

1. Curie corrects the receiver wording in the two author documents and seals a
   new packet; all other approved bytes/selectors and current preimages stay
   checked rather than silently overwritten.
2. Root supplies the exact full final String source manifest and independent
   current-composition approval. Root-reported 85 owned controls, 9,104 SafeJS
   passes/39 skips and 68 builds remain attributed reports, not reviewer runs.
3. Attach Noether's exact two-selector native/public receipt and artifact binding;
   the reviewer can then reuse it without duplicating runtime work.
4. Publisher rechecks all three document preimages and current composition, and
   explicitly pairs these docs with the approved ordinary-String feature release.
   **Standalone docs publication is forbidden.**
5. An assertion of actually released support requires the target release receipt.
   The draft has no assigned target version and does not claim 13.0.1 implements
   ordinary String or own guest hooks.

The README's present-tense feature wording is acceptable only within that paired
release gate. It is not permission to publish an unsupported current contract.
No final source approval, future release version, npm success or all-stack
readiness is inferred from historical evidence or static formatting.

## Static handoff

The frozen packet retains the original two author images, this unique report,
exact preimages, selected historical/source evidence and independent preservation
checks. Small three-document formatting and strict forward/reverse patch checks
are recorded separately from semantic approval. No author/source/test/shared
README, ledger, home/SKILL, original archive or Git publication is changed;
no runtime, install, build, test, compiler or bulk hash command runs.

**Final static-phase status: HOLD for the narrow arrow-`this` wording correction
and the named source/example/paired-release prerequisites.** Preservation and
exact current preimages pass; there is no need to wait silently for runtime work
to report this actionable documentation finding.

## Corrected conditional approval — August 30, 2026

**Documentation READY, conditional on final independent String source approval
and paired feature publication.** The arrow receiver finding is resolved and
the two exact public SDK examples have authenticated local-candidate results.
There is no remaining documentation wording or exact-example blocker. This is
not standalone publication permission, final source approval or an assertion
that current actual 13.0.1 supports the feature.

The original 8,909 report bytes, SHA256
`5c10359babbd4e29852d493045743500bea12e48bac706549396de7f932051ed`,
remain an exact prefix. Static HOLD manifest
`d349e86e34c40b8bdcb3f673851c2dd0628ad885251cc1fdab174d26a0331ef5`
and original author manifest
`b31482e47993053dafbefe982ba38c1d13a2071d318521809b38c6aa9057d447`
remain immutable. The disk-capacity pause did not cause evidence deletion or
replacement; this appendix follows root's explicit renewed LIGHT authorization.

### Corrected author packet and current preimages

The corrected manifest is
`/Users/kjopek/Workspace/poe-code-safe-js-string-readme-author/out/safe-js-string-readme/arrow-corrected-release-gated-candidate/manifest.json`,
SHA256 `9c1c8611b15bac76f0148fff0889226757ec751b832630c3b58a206c7b8633f9`.
Its exact base remains `420233dc9af5977bee2cec5688cfa58bdd55ab40`.
All declared document/patch images and its two evidence copies are authenticated.
Read-only Git objects independently verify these three publication identities:

- `packages/safe-js/README.md`: present preimage, 49,379 bytes, SHA256
  `afab33547472dcde6209331a9311179c2b20c8d0594f80c59a3f245d79f1f152`;
  unchanged corrected author postimage, 50,446 bytes, SHA256
  `36e546c7e8d4da3386969606d0b6c55003e76274e893e98050e2ee999e992159`.
- `docs/plans/safe-js-string-coercion-readme-release-handoff.md`: absent
  preimage; unchanged corrected author postimage, 10,454 bytes, SHA256
  `3e9ebf818319f72e12465b31bfe93c7d2ca4724de6571c5ee4cc4565c0bd35e1`.
- `docs/plans/safe-js-string-coercion-readme-independent-review.md`: absent
  preimage; this append-only reviewer postimage, fully identified in the new
  manifest.

The README correction is exactly the requested receiver-sentence replacement;
every other byte of the prior author README is unchanged. Ordinary unbound
function hooks receive the converted object, arrows retain lexical `this`
including when bound, and bound ordinary functions use their bound receiver.
The author plan makes the same distinction and adds the corrective evidence
and remaining release conditions. This resolves
`STRING-README-ARROW-THIS-QUALIFICATION` by a documentation correction, not by a
new source behavior or an invented arrow runtime test.

Relative to the current main preimage, only the two authorized String regions
change. All eight existing fences, all other README bytes and both new selector
sources/expectations remain unchanged. The explicit-only, passive-operation,
implicit-addition/O08/symbol/prototype/accessor/boxed-String qualifications remain
intact, along with the existing Array/sticky/in text and prior examples.

### Authenticated exact public SDK results

Noether's root-pinned receipt is
`/Users/kjopek/Workspace/poe-code-safe-js-string-noether-review/out/safejs-remediation/string-current-independent/tmp/run-2026-08-30T111548561Z/readme-candidate-receipt.json`,
SHA256 `3bcb391fdaca145aeddacdc84dc3d66149a8a56b05912bdee4d89a727b07a738`.
Independent metadata review checks its full 1,187-byte stdout against SHA256
`e2486eeb383fe7597440235f8ad106920ea346317f2e3f593d580bcf708eb9ae`
and confirms the parsed records match the receipt exactly. The command exits
zero with null signal, zero stderr bytes and finish time
`2026-08-30T11:20:46.653Z`. Its recorded timeout is 15,000 ms.

The command's exact stdin matches SHA256
`da8b944b2af32a56cc684efee96fe280275e8ffeed2341e6ea39bc2f25ffed2f`.
It imports the public `poe-code/safe-js` SDK, awaits `api.run(test.source)`,
checks `result.ok`, checks a string return type and compares the complete
`returnValue` with the expected value. It does not replace the guest source
or use a surrogate Error-shaped object.

- `README-STRING-ORDINARY`: exact source
  `return String({ value: 1 });`; `apiOk: true`; actual primitive string
  `"[object Object]"`.
- `README-STRING-GUEST-HOOK`: exact source
  `return String({ toString() { return "custom"; } });`; `apiOk: true`;
  actual primitive string `"custom"`.

Both record package `0.0.0-dev`, the candidate head
`420233dc9af5977bee2cec5688cfa58bdd55ab40` and resolved public entry
`/Users/kjopek/Workspace/poe-code-safe-js-string-noether-review/packages/safe-js/dist/index.js`,
whose execution-time recorded SHA256 is
`e68636db45fba9767962b374f7ba555c0b2d6fee211aac9b59f3370057afccc6`.
The receipt binds source-author manifest SHA256
`da5bc65d5935bffd291a492555bd303557c94f3e02189b20d29cb82015a95e70`.
This review does not infer an absent source-capsule locator or final independent
source approval from that digest.

These are **2/2 exact local built public SDK passes**, not actual npm or
installed/packed release validation. The execution-time entry hash is retained;
the entry/chunks are not rehashed here. The command receipt does not record cwd,
and its source-head field is a caller-supplied label, not an independent Git
proof. Final source/artifact binding therefore remains part of Noether's final
source seal and publisher gates, rather than being invented by this docs review.

The same recorded command checks canonical/legacy SDK functions and matching
core/CLI exported values. Its bin table is metadata, not a new bin execution.
This receipt contains no native comparison, fresh replay or arrow-specific
runtime witness; none is claimed. Those omissions do not turn the two exact SDK
passes into a full feature-matrix approval. Root has delegated the separate
current source/replay work to Noether; no duplicate target runtime runs here.

### Remaining publication conditions

1. Attach the exact final source-capsule locator and Noether's final independent
   String approval, bound to the declared author digest and actual composition.
   Root-reported completed heavy gates are not substituted for its pending seal.
2. Publisher rechecks all three current document preimages and normal composition
   gates. A later README collision requires author integration, not overwrite.
3. Pair this packet with the approved ordinary-String source publication.
   **No standalone docs publication and no 13.0.1 support claim.**
4. Before asserting actually released support, bind the actual target release
   receipt/version. Local `0.0.0-dev` results must never be relabeled npm release
   evidence.

Under root's requested release gate, the absent native/full-source/actual-release
certifications are not silently upgraded by the two SDK observations. The
historical prototype disposition is not reopened or broadened, and no old
capture repair or implicit-conversion feature is promised.

The new immutable packet contains exactly the two unchanged corrected author
documents and this append-only independent report. It records small configured
three-document formatting, strict forward/reverse patch checks and all current
preimages. No runtime, install, build, tests, compiler or bulk hashing occurs;
no author/source/test/shared README/ledger/home/SKILL/Git publication is changed.

**Final disposition: docs READY, conditional on final String source approval,
fresh publisher gates and paired publication.** Earlier HOLDs remain historical
evidence; their resolved wording finding is not left open in this current
disposition. Root alone authorizes release.
