# Explicit String conversion README release handoff

## Status and ownership

August 30, 2026: **DRAFT FOR INDEPENDENT REVIEW; STRING RELEASE PAIRING REQUIRED.**
This README postimage describes the proposed explicit String feature, not the
currently installed or published runtime. No target version, release success or
current-package example PASS is assigned. Do not publish this documentation alone.
Root identifies the current actual 13.0.1 package as not yet implementing this
feature. That version is not a target or a String-support claim in this draft.

Fresh isolated author clone:
`/Users/kjopek/Workspace/poe-code-safe-js-string-readme-author`.
Clone and immediate `git pull --ff-only` reached
`420233dc9af5977bee2cec5688cfa58bdd55ab40`. Applicable AGENTS were read before edits.
The base includes the published README work at
`7ffb8cd305e0f385f90308c834949d83861872fe`, source
`a709a292997bc167d594a736391df64e3a432c68` and newer filesystem documentation.
The newer upstream text is preserved, not replaced by an earlier README image.

Exactly two author publication paths:

- `packages/safe-js/README.md`: preimage SHA256
  `afab33547472dcde6209331a9311179c2b20c8d0594f80c59a3f245d79f1f152`,
  49,379 bytes, at the exact base above.
- `docs/plans/safe-js-string-coercion-readme-release-handoff.md`: absent at that
  base; this unique handoff, not a rewrite of the prior released-value plan.

No source, tests, master ledger, other README, installed/home SKILL, original
audit payload, branch, commit or push is touched. No runtime, install, npm,
build, tests, compiler or bulk-hash task runs while Sartre owns the CPU window.
Only scoped document formatting, exact doc/evidence identities and static patch
checks are performed. QA remains this Markdown procedure, not an executable file.

## Feature evidence and final-candidate hold

The supplied refresh manifest is
`/Users/kjopek/Workspace/poe-code-safe-js-string-coercion-released-prep/out/light-refresh/manifest.json`,
observed SHA256
`2d23bfebfb4394d4fc3ac9fd7d55b6aecc05d51e9e419170444126a233e8bd6e`.
Its recorded status is `LIGHT_RELEASED_SOURCE_REFRESH_HOLD_NO_RUNTIME`, on
`1b180668e29f43421ab2b89210a17ab6eab8c06e`; it is not the final source seal.
Root separately reports author validation on a709: 9,104 SafeJS passes, 39 skips,
85 owned controls and 68 builds. Those are attributed root updates, not checks
rerun by this docs author or evidence inferred from the older refresh manifest.
Root subsequently reports the final author candidate based on a709 with production
unchanged. Noether's candidate-example receipt now records the full author identity
`da5bc65d5935bffd291a492555bd303557c94f3e02189b20d29cb82015a95e70`.
This is a receipt-derived source identity, not a new verification of that source
capsule. Its exact manifest locator and final independent seal must still be
attached before publication.

The prior frozen scope review is
`/Users/kjopek/Workspace/poe-code-safejs-string-coercion-integrated-independent/out/safejs-string-coercion-integrated-independent/manifest.json`,
SHA256 `b3d30ab777f0b7a5052ebfc4aee7ce8c8b35735c951186f4c5dce7f86212f227`.
Its retained review postimage is
`postimages/docs/plans/safejs-string-coercion-independent-review.md`, SHA256
`a29fb51c8f057c19d722e39a588d9b409f6d0d58c173b774e002f02de0341ddc`.
Its explicit-conversion helper is
`postimages/packages/safejs/src/interp/string-coercion.ts`, SHA256
`6ece85e437ea1b6de984c700220593414ff8660c74cff56559742587de120974`.
These exact identities were checked and their bounded scope read. Historical
package paths remain historical; no old source is installed in this author clone.
The prior READY disposition is not final approval of the newer composition.

## Minimal README change

Only the String built-in bullet and former narrow String(Error) paragraph change.
The latter becomes two short paragraphs and retains its exact branded-Error
example. There are two new inline expressions and no new fenced example.

- Explicit `String(value)` admits ordinary represented-object defaults and own
  guest hooks. `toString` is tried before `valueOf`; the latter is reached only
  when needed. Absent defaults and present noncallable hooks are distinct.
- Ordinary unbound function hooks receive the converted object. Arrow hooks retain
  lexical `this`, including when bound; bound ordinary functions use their bound receiver.
  Nonprimitive results continue conversion, thrown values propagate and exhausted
  attempts throw `TypeError`. Hook calls use the existing interpreter budget and
  exception path, not host coercion of internal records.
- Array/admitted Float32Array default joining and branded Error formatting are
  included. Error-shaped plain records do not acquire an Error brand.
- Opaque host functions are not a conversion-hook invocation path. Accessors,
  symbol/prototype hooks, boxed String construction, implicit object coercion in
  binary addition and O08 source-callable own-property writes are not enabled.
- This feature introduces no hook execution into passive copying, digesting or
  checkpointing. Explicit String calls may execute during replay reconstruction;
  this is not an unconditional non-invocation or exactly-once guarantee.

Current Array callback mutation restrictions, regex/sticky and binary-in guidance,
Map/Set semantics, Float/locale examples, browser/FS/canonical names, host-operation
policies, error-identity rules, all existing fences and configuration remain intact.
No universal JavaScript support or native-prototype parity is promised. The prior
actual 12.0.11 prototype review is a scoped PASS reported by root (f717 reference),
not an OPEN status to revive or permission to expand historically broken capture
compatibility. No prototype disposition is changed in this String-only patch.

## Exact two-selector handoff to Noether

These sources are proposed examples to validate, not commands executed here.
Each source is complete guest code; its expression is copied literally into the
README. Expected values are exact primitive strings, not substring projections.

| Selector                   | Complete guest source                                 | Expected `returnValue` |
| -------------------------- | ----------------------------------------------------- | ---------------------- |
| `README-STRING-ORDINARY`   | `return String({ value: 1 });`                        | `"[object Object]"`    |
| `README-STRING-GUEST-HOOK` | `return String({ toString() { return "custom"; } });` | `"custom"`             |

Agent-executed procedure, after root runtime authorization:

1. Pin the final approved String candidate and the exact artifact used. If local
   packed validation precedes publication, label it local; do not relabel it as
   actual released npm or use it to invent a target version.
2. Run each unchanged source against native JavaScript and the unmodified public
   `poe-code/safe-js` SDK `run()` with no bindings, modules, provider requests,
   guest I/O or caller adapters. Keep normal configured budgets/deadlines; do not
   weaken or retry an assertion with a larger timeout.
3. Require no API rejection, resolved `ok: true` and the exact complete
   `returnValue` above. Capture full result/stdout/stderr, native return, source
   hash, command and artifact identity. The ordinary object case must not be
   replaced by an Error-shaped object or a custom-hook surrogate.
4. Keep any failure and report its actual cause. Do not change the literal source,
   expected value, public bundle or import path to obtain a pass. These two small
   controls do not certify hook ordering, prototype parity, old checkpoint
   migration or the complete feature matrix; those remain source-review scope.
5. Attach Noether's receipt for Aquinas's independent documentation review. Root
   and publisher must pair the documentation with the approved String release
   and current composition gates. An actual-release claim requires its actual
   receipt; this draft carries no such claim.

## Corrective review and local example receipt

Aquinas's static HOLD manifest is
`/Users/kjopek/Workspace/poe-code-safejs-fs-type-timing-independent/out/safe-js-string-readme-independent/static-release-gated-20260830/manifest.json`,
SHA256 `d349e86e34c40b8bdcb3f673851c2dd0628ad885251cc1fdab174d26a0331ef5`.
It identified overbroad unbound/bound receiver wording, not a runtime failure.
Only that README sentence is corrected; the plan matches ordinary-function,
arrow lexical-`this` and bound-ordinary-function semantics explicitly. Prior
author capsule `b31482e47993053dafbefe982ba38c1d13a2071d318521809b38c6aa9057d447`
and the independent HOLD remain immutable. Fresh pull is still at the base above.

Noether's exact receipt is
`/Users/kjopek/Workspace/poe-code-safe-js-string-noether-review/out/safejs-remediation/string-current-independent/tmp/run-2026-08-30T111548561Z/readme-candidate-receipt.json`,
SHA256 `3bcb391fdaca145aeddacdc84dc3d66149a8a56b05912bdee4d89a727b07a738`.
The supplied receipt bytes are verified. Both selector sources and expected values
match this handoff exactly, and both records have `apiOk: true` with their exact
primitive-string `returnValue`. No source, expectation or example is changed.

This is the current local built public SDK candidate, package `0.0.0-dev`, on
recorded head `420233dc9af5977bee2cec5688cfa58bdd55ab40` plus the stated String
candidate. The receipt records entry SHA256
`e68636db45fba9767962b374f7ba555c0b2d6fee211aac9b59f3370057afccc6`
and `actualPublishedPackage: false`. Neither the artifact nor its stdout is
rehashed or executed here; only the exact supplied receipt is read. These two
passes are not native/full-feature certification, an arrow-specific runtime test,
released npm evidence or final independent source approval. The final String
independent seal and all release-pairing requirements remain pending.

## Intake requirements

The author packet contains two exact postimages, the current README preimage,
absent-plan identity and full patch. It records static preservation and document
checks only. The local two-example receipt is attached with its limited scope;
the final String source manifest locator, independent approval and target release
identity remain explicit pending prerequisites.
If upstream changes either path, recompute narrow current preimages rather than
overwrite newer content. Aquinas reviews; this author cannot approve its own docs.
