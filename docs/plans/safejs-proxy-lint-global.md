# Proxy lint/runtime parity

The committed runtime exposes Proxy, but lint reported AS003 for construction
and Proxy.revocable. Three failing regressions reproduced these two rejections
and the missing shadowing warning; the misspelled-name rejection control passed.

Add Proxy to the existing known-runtime-global declaration. Do not add the
uncommitted weak-collection bindings as part of this repair or weaken unknown
identifier checking. Runtime-backed tests exercise reads and revoked access.

Run the lint directory and harness tests, plus scoped ESLint. A manual CLI
fixture exercises construction and revocation through the default lint gate.
The maintained screenshot route captured it successfully, and visual inspection
confirmed answer 42, active before revocation, TypeError afterward, and ok:true.
The image is an ad hoc artifact, not a committed screenshot test.

README updated. This restores one implemented feature's lint parity, not full
JavaScript completeness. Pushes and releases remain paused.

Verification: 650 tests passed across 49 lint/harness files; the direct CLI smoke
command exited 0. The screenshot was reviewed at
`/tmp/safejs-proxy-lint-visual.BynKfT/proxy.png`.
