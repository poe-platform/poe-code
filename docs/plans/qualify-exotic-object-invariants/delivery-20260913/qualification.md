# Delivered exotic-object qualification

Acceptance remains incomplete. This report distinguishes verified semantic
repairs, source qualification, remote delivery and publication observations.
Unrelated original working/staged changes are preserved. Delivery uses a separate
local clone on main fetched from origin, without force-pushing divergent history.

## Source qualification

The complete recorded selection ran on delivered source
67febf8674976d0b08c1d8e94619eaddc17e62b8: **747 files, 1,478 variants, 1,408
passes, 67 failures, 3 unsupported**, no metadata/execution errors. Node 22.23.2,
ICU 78.2, V8 12.4.254.21-node.56, Darwin arm64. full-upstream.jsonl preserves
source hash, exact commands/settings, fixture/harness hashes, all results and
terminal summary. nonpasses.json preserves every nonpass without filtering.
The compatibility target remains ECMA-262 edition 16 (June 2025), ECMA-402 edition
12 and explicitly tracked newer APIs. Test262 revision is
419d3e0a2273ba01a3bfcbec423f2801425b8e93.

- 66 worker-wall-timeouts remain failures under the unchanged 3,000 ms deadline.
- The remaining throw is private-class-field-on-nonextensible-return-override.js,
  which targets the separately unpinned nonextensible-applies-to-private feature.
  Prior edition-16 private-field/method/accessor controls establish the edition
  disposition; the raw failure remains visible and is not counted as passing.
- Two shared-memory modes and one module mode remain unsupported capability
  cases on this delivered source. The module case is
  Proxy/preventExtensions/trap-is-undefined-target-is-proxy.js. A withheld host
  capability is not classified as an ECMAScript defect.

Reproduction from the delivery checkout:

```sh
npm run test:conformance --workspace=@poe-code/safe-js -- --corpus /tmp/safejs-exotic-test262 --report /tmp/exotic-delivered-full-67feb.jsonl --include built-ins/Proxy --include built-ins/Reflect --include language/statements/class/subclass --include language/statements/class/subclass-builtins --include built-ins/Array/prototype/slice --include built-ins/TypedArray/prototype/subarray
npx vitest run packages/safe-js/src/interp/exotic-invariant-qualification.test.ts packages/safe-js/test/integration/exotic packages/safe-js/src/host-result-prototype-replay.test.ts packages/safe-js/src/proxy-data-copy.test.ts packages/safe-js/src/proxy-host-callback.test.ts packages/safe-js/src/interp/clone-prototype-independent.test.ts
npx eslint packages/safe-js/src/interp/exotic-invariant-qualification.test.ts packages/safe-js/test/integration/exotic-*.test.ts
```

Use a fresh report pathname. Full replay exit: 1. Independent exact-trace,
mutation, coercion, constructor, authority-boundary and repeated-snapshot checks:
118/118 pass, zero failures/skips, lint exit 0. Five earlier task qualification
files were copied unchanged from the original checkout and independently
revalidated here before delivery; no unrelated original files were committed.
No runtime, assertion, timeout, support policy or accounting root was weakened.
No visual CLI behavior changed.

## Verified commits and scoped publications

Normal hooks ran on commit/push; npm prepare installed the maintained Husky
hooks. Each source commit was fetched and verified as an ancestor of remote main.

| Source commit                            | Change                           | Scoped version | Workflow                                                          |
| ---------------------------------------- | -------------------------------- | -------------- | ----------------------------------------------------------------- |
| d45c2826c3e1a8951d68ff6f9891cf07706c349d | Seven constructor-order controls | 0.1.586        | https://github.com/poe-platform/poe-code/actions/runs/34779284805 |
| 19df5532d28b8c9e3e48dbecdb09894f530df2f5 | Tracking subarray species arity  | 0.1.587        | https://github.com/poe-platform/poe-code/actions/runs/34779459613 |
| 67febf8674976d0b08c1d8e94619eaddc17e62b8 | Foreign intrinsic Array species  | 0.1.588        | https://github.com/poe-platform/poe-code/actions/runs/34779560823 |

All three scoped workflows completed successfully, publishing safe-js, safe-fs
and safe-bash under @poe-platform. scoped-publications.json records all nine
independent version/integrity/provenance observations. Every downloaded tarball
matches its registry SHA-512 integrity, and each inspected SLSA provenance
statement resolves to the expected source commit and workflow invocation.
Independent cryptographic verification of the provenance bundles was not run.
Installed maintained smoke checks pass on Node and Bun for every publication.
The installed 0.1.587 and 0.1.588 APIs return two tracking species arguments;
0.1.588 also selects the local Array default for the foreign intrinsic while
still observing proxy-wrapped species.

Registry propagation produced ETARGET/404 results through npm view/pack, exact
version endpoints and tarball/attestation endpoints after successful workflows.
Those initial install/probe attempts were unavailable, not passes. Retried
read-only requests eventually retrieved all nine verified artifacts. SafeFS and
Safe Bash were independently installed/probed while SafeJS propagated. See the
executed Markdown manual-qa.md; no local publication or rollback was attempted.

## Remaining release and task gates

At this report's commit, the first root Release run 34779284956 remains in its
unit job. Run 34779459818 was cancelled while pending; successor 34779560917
contains its fix (verified ancestry). Schema run 34779459562 was superseded by
successful descendant 34779560810. Root publication is not yet claimed; its
workflow and registry outcome will be appended after observation. Baseline
poe-code is 15.0.34 at f7026625e77f32471f7219feee8e2d1d5dc52b58. A passing test-only
root run without a new version must be recorded as no-release.

No associated issue was supplied. The task remains incomplete for 66 pinned
deadline failures and broader runtime/category gates. Recovery: profile and
repair retained-data execution cost without removing accounting roots or
changing deadlines, rerun the complete selection and supported runtime cells,
and verify the resulting installed artifacts. Pending root/scoped successors
must be monitored through publication; do not infer success from ancestry or
successful publication of only a subset of packages.
