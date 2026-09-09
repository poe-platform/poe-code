# Proxy extensibility traps

On the private Proxy foundation, all 12 initial Object/Reflect tests fail
(58417): operations mutate the carrier instead of its target, ignore handlers,
accept invariant violations and ignore revocation. Existing public constructor
requirements remain a separate unfinished feature.

Implement the isExtensible/preventExtensions internal methods, including nested
targets, guest-call dispatch and Boolean coercion. Keep ordinary-object paths
synchronous. Object.preventExtensions throws on refusal; Reflect returns false.
Charge proxy fallback traversal to the step budget and retain state through the
existing trap lifecycle wrapper. No host Proxy or guest-global exposure added.

Reference: [ECMA-262 sections 10.5.3–10.5.4](https://tc39.es/ecma262/2026/multipage/ordinary-and-exotic-objects-behaviours.html#sec-proxy-object-internal-methods-and-internal-slots-isextensible).

Initial verification passes 41 tests across three files (17050). Expanded nested
target, false-return short-circuit, budget and synchronous-control tests are
running. TypeScript/scoped lint run as 52704. No complete public Proxy support,
full-package gate, push or release is claimed for this change.

Expanded run 90376 passed 58 cases and exposed one incorrect new-test assumption:
Reflect's unchanged async wrapper already returns a Promise at committed HEAD.
The control now verifies the intended invariant directly: mutation occurs before
awaiting the result, with Object/Reflect return values checked afterward. No
production change was made for that test failure. TypeScript and production
scope lint pass (52704). The corrected selection passes all 59 tests across
four files and the final test-file lint (77840, exit 0). These operations are
ready as an atomic internal implementation step; the public Proxy API remains
unfinished and its 32 constructor-level requirements are not claimed as green.
