# PPTX font formatting implementation

Scope: F17 run formatting using the existing bounded package/XML engine, plus original color values. Root only exports package APIs; safe-bash adapts the package command engine. No full pipeline, push, release, README changes or external fixture distribution.

Ownership: the package engine delegate owns `text-runs.ts` and its original regression tests. The audit delegate owns `text-run-color.ts`, `font-color-cases.test.ts`, this plan and font formatting research/usage documents. Root owns command schemas, command tests, adapters and integration. Existing unrelated work remains untouched.

## Evidence and procedure

1. Read the pinned test/API inventories and audits, shared CLI/SDK contracts and format specification.
2. Write failing original XML assertions before adding formatting/color behavior. Preserve numerical boundaries and every applicable expanded parameter variant. Avoid source assets and private proxy implementation assumptions.
3. Validate original package mutations in memory and through the command engine. Compare edited XML to independently specified attribute values, child names, ordering and literal brightness transforms; reopening alone is insufficient.
4. Run maintained package tests/lint, applicable safe-bash checks and a CLI screenshot for exposed flags.
5. If disposable QA is needed, use only manifest-listed cached inputs. Verify the recorded SHA-256 first, admit bytes through explicit capabilities, edit one selected existing run, and compare untouched parts. Do not acquire fonts or invoke a native rendering runtime. Reduce a meaningful finding to original in-memory XML before removing any owned QA outputs. No download-dependent unit tests.
6. Commit explicitly owned files only after checks pass. Report local commit separately; do not push.

## Case accounting and limitations

The companion `docs/pptx/font-formatting-case-map.json` is a focused overlay on the historical baseline inventories. It retains exact research identities and separate source rows. It distinguishes observable XML coverage from public live-model coverage and never treats source proxy allocation as proof of a public TypeScript getter.

There are 42 font model unit variants, 54 color unit cases, 14 color/percentage XML cases and 11 hexadecimal scalar cases in the focused scope. The 65 font/color feature rows include three hyperlink scenarios, which are accounted as outside this formatting increment. Font-file discovery/metrics tests belong to explicit-metrics text fitting, not run styling; they are not executed by the product.

The current package architecture exposes async byte-oriented edits and independent read inspection, not the full live Presentation/Font object graph. A standalone ColorFormat accepts an explicitly supplied bounded XML part. Neutral public model names, inherited members, enums and helper protocols remain visible obligations in the API overlay. RGB helper parsing deliberately requires exactly six ASCII hex digits, matching J05. Plain six-digit CLI colors remain the shared Color contract; typed SDK RGB/theme objects and matching operation JSON are explicit extensions, not a redefinition of every common Color resource.

## Validation receipt

- Initial color test run failed because the module did not exist.
- First implementation exposed 20 failing XML merge cases; mutually exclusive remove/upsert requests were corrected without changing the independent expectations.
- Color suite: 77 passing cases, 26 ms test execution at the final delegate checkpoint. Font suite: 80 cases and two memfs SDK integration cases pass.
- Coordinator checkpoint: 1,445 tests across 54 files, package lint and selected workspace build passed before final parser follow-ups. The coordinator records final checks and commit.

## Final integration verification

- `npm run build:workspaces -- --workspace=pptx`: passed the maintained selected workspace build closure.
- `npm run test --workspace=pptx`: 54 files, 1,478 tests passed.
- `npm run lint --workspace=pptx`: source ESLint, production TypeScript and test TypeScript passed.
- Actual safe-bash adapter: 86 tests passed; see [CLI QA receipt](pptx-font-cli-qa.md).
- Corpus QA verified equal SDK/CLI bytes and 37 untouched members; scoped CLI help/error screenshot visually reviewed. No slide-rendering claim.
- Review findings became original regressions: null run selectors before input I/O, numeric/symbolic underline parity, list/get cardinality, missing mutation selection and scoped help.
- Source formatting checked; existing unrelated formatting in the adapter test file is preserved. Only added imports and original cases are staged.
- This is one atomic font-formatting increment. Full live Font graph, complete symbolic language/color enums and table/cell selector coverage remain explicit API gaps in the focused register. The 3 hyperlink BDD cases are outside this increment. No whole-public-API completion is claimed.
- No README, downloaded fixture, root API implementation, push or release changes.
