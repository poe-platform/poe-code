# External guarded runtime profile: author handoff

August 27, 2026. Source `6dc79cd58ba57dbbac9aff390af73d05368ccb56`; product candidate remains
`8670ebe8f0d39966c2de2638780437398e5f8490`. This patch changes the external
gate harness only, not product engines, package metadata, authentication hooks,
source/tests in the frozen candidate, or native tool policy.

## Profile and API

`profile.mjs` exports `gateProfile`, `inspectRuntime(executable?)`,
`probeGuardedRuntime({ executable, root, source, harness, guard,
expectedSource, environment })`, and `requireMatchingLauncher(receipt)`.
The profile pins the installed Darwin arm64 Node 24.11.1 executable at
`/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node`, SHA256
`4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
This is an explicitly qualified external-gate runtime, not a latest-version
claim or a change to ordinary Node >=22 product support.

The gate CLI requires that launcher identity before archive/output creation.
Its feature probe then runs the unchanged authenticated loader with tsx and the
pinned TypeScript CJS API, imports the candidate execution/env-split sources,
and checks selected-runtime direct-exec and default PATH children before any
suite phase. Unsupported identity/interoperability returns status 78, not a
passing or skipped suite. npm phases use the selected Node explicitly with the
captured npm CLI. Sampled absolute Node child paths must match the selected
runtime; this sampling is not exhaustive tracing of every short-lived or
explicitly overridden nested child. The feature probe does not certify all
product bodies or nested permission-isolated consumer environments.

## Executed controls and independent boundary

`AUTHOR_RESULTS.json` is the unchanged captured author result: **11/11**
controls, zero product command executions and no whole/package cohort launch.
It preserves the Node 22.22.2 null-source failure as a status-78 profile refusal,
not a product-wide incompatibility conclusion. Controls cover positive loader
interop, default/direct child identity despite a legacy-first input PATH,
actual legacy CLI refusal before output creation, critical-source tamper and
missing source, outside overlays, disabled guard, compiled fallback, and changed
CJS tool bytes. Scratch was removed; no private repository access occurred.

Reproduce this bounded author check with a unique output path:

```sh
node tests/integration/full-gate-20260827/runtime-profile-20260827/controls.mjs /tmp/UNIQUE-runtime-profile-results.json
```

The default Node22 launcher is intentional for that control harness: it invokes
both pinned Node24 and the historical Node22 diagnostic child explicitly.
The actual external gate must instead be launched using the pinned Node24
absolute path; its archived product candidate and native49 preflight remain
unchanged. No further whole gate is authorized by this report.

Independent review of **this preflight patch** is accepted in `c7489e14`
(harness `b7ef6f46`): 24/24 controls, comprising 22 executed controls and two
source-policy checks, plus the unchanged 11 author controls. `inspectRuntime`
executes the requested binary before checking its hash: this is trusted-host
diagnostic admission, not an untrusted-binary sandbox. Separately, Plato's
`0579a239` evidence in
`../loader-null-source-review-node24-bodies/README.md` establishes 45/45 actual
unchanged affected test bodies on this Node24 profile, including isolated actual
SafeJS. Those results are not the 11 controls and are not a new whole-gate score.

## Remaining package cohort

The separate fresh-archive 8670 package cohort is prepared, not executed here.
It must not resume mutated attempt-v4. The historical **17,454/12/0** raw run
remains unqualified and unchanged; package results, when executed, will be a
separate named cohort, not completion or rescoring of that attempt.

`RECEIPT.json` binds the committed harness files and raw author result.
Root exports, manifests and product files were not changed by this evidence.
