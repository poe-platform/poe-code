# DOCX Upstream Test Audit

Status: Research complete for the pinned baseline; bounded style/formatting
TypeScript adaptation is recorded in [the scoped audit](style-formatting-audit.md)
and [case map](style-formatting-case-map.json). Full format adaptation is pending.

The [bounded XML/package record](xml-package-views.md) links original memfs
assertions and retained source-case pointers separately. It does not count
source/native-runtime cases as new passes or promote whole-format parity.

## Pinned source

- Repository: [https://github.com/python-openxml/python-docx](https://github.com/python-openxml/python-docx)
- Commit: `e45454602b53e8e572b179ccf1c91093ec9f4ed7`
- Temporary clone: `/tmp/docx-upstream-review`
- License: MIT, with the original copyright and permission notice retained in [the research notice](upstream-license-notice.txt). Any substantial copied/derived material needs the notice retained in an appropriate standalone legal file.
- Product code, code comments, test names, fixtures and CLI output must contain no reference-project identities. Reference links belong in plans/research and legally required notices.
- Shared behavior comparison: [python-pptx test audit](../pptx/upstream-test-audit.md), with its own pinned results and denominators. Neither suite's passes establish the other format's behavior.

## Baseline verification, 2026-09-14

The [verification receipt](upstream-baseline-verification.json) records checks of
the retained inventories, coverage summaries and local source. All 625 tracked
DOCX checkout files match the pinned commit's Git blob hashes. Its existing index
is empty, so index-based status alone is misleading; the checkout was not repaired
or changed. The 39 documentation, 45 source and one auxiliary API hashes also
match. Unit IDs and expanded BDD identities are unique; every recorded source
path and line exists. All 95 per-file coverage summaries sum to the totals below.

The six temporary raw artifacts listed in the original evidence are absent,
including both initial failure logs, JUnit, coverage JSON and successful run logs.
Their retained SHA-256 values cannot be reverified without those bytes. The
counterpart's six raw artifacts are also absent, and its source directory lacks
Git metadata. Its retained inventory and 101 coverage-file summaries reconcile,
but this review does not freshly verify its commit or execution. These are
evidence-retention limits, not failed test results or newly passing executions.

No DOCX source or retained-result discrepancy justified a rerun. The dependency
failures, historical passes and exact denominators below remain unchanged; no
Python environment was installed or executed. The [owned task record](../plans/docx-test-baseline-verification.md)
contains the verification and conditional reproduction procedure.

## Shared OPC, XML and image evidence

Both inventories cover part-relative URI construction and relationship-part
names (`tests/opc/test_packuri.py`), package/relationship graphs
(`tests/opc/test_package.py`) and content-type/relationship XML
(`tests/opc/test_oxml.py`). The DOCX package graph cases include cycles and external
edges; XML cases distinguish absent/internal/external target mode and empty
content-type lists. These are useful shared semantic inputs, not proof of bounded
ZIP admission, DTD rejection, unknown-markup fidelity or capability-safe I/O.
Those additional requirements remain governed by the shared contracts.

DOCX `tests/image/test_image.py` and counterpart `tests/parts/test_image.py`
exercise bytes, media types, pixel dimensions, DPI, compatibility hashes and
native/one-dimension/two-dimension sizing. Their format/decoder paths differ:
DOCX has format-specific header tests, while the counterpart includes Pillow
metadata behavior and a WMF media-type case. Do not infer identical supported
formats, reuse a host decoder as a runtime requirement, or merge coverage totals.
Original bounded image cases must preserve each applicable edge in later tasks.

The [public API reconciliation](upstream-api-reconciliation.md#language-and-security-decisions)
records the exact JS mappings and 23 documentation/source resolutions separately
from test coverage: always-async admission/publication; synchronous admitted
model access; neutral snake_case names; sequence versus keyed lookup; null and
typed values; checked units, UTC dates, owned bytes and bounded XML/package views.
Its per-axis DPI and rounding decisions take precedence over copying source
defects. SHA-1 is compatibility metadata; provenance uses SHA-256. Inherited
members, enums, collections, helpers and documented underscore-prefixed types
remain in scope even without upstream tests.

The [shared CLI](../specs/office-cli.md) and [shared SDK](../specs/office-sdk.md)
remain authoritative: plural `images`, `tables`, `properties`; preserving
`text replace` distinct from destructive model setters; common flags, selectors,
versioned JSON, exit statuses, `schema` and `capabilities`. Concrete per-member
API/CLI/test maps and broader specification reconciliation are separate pending
tasks. This baseline verification does not complete them.

## Executed results

| Measure                                            |                 Result |
| -------------------------------------------------- | ---------------------: |
| Collected unit cases, including parameter variants |                   1609 |
| Unit passes                                        |                   1609 |
| Unit failures / errors / skips                     |              0 / 0 / 0 |
| Statement coverage                                 | 7,407 / 7,612 (97.31%) |
| Branch coverage                                    |     884 / 996 (88.76%) |
| Coverage-excluded lines                            |                    240 |
| BDD feature files                                  |                     67 |
| Expanded BDD scenarios/examples                    |                    650 |

Unit command: `python -m pytest tests --cov=docx --cov-branch --cov-report=json --junitxml=... -q`. A temporary collection plugin recorded actual node IDs; it did not change execution. BDD command: `python -m behave --format progress --tags=-wip`, matching upstream tox policy; the recorded run reported zero skipped scenarios. BDD was executed separately and is not included in the unit coverage percentage.

Environment: isolated Python 3.11.13 virtualenv, pytest 8.4.2, pyparsing 3.2.3, coverage 7.16.0, behave 1.3.3, lxml 6.1.3 and Pillow 12.3.0. Editable packages point to the pinned clones. Product code does not use this environment.

The first run with pyparsing 3.3.2 failed collection because the suites treat its API-deprecation warnings as errors. Pinning pyparsing 3.2.3 exposed pytest 9.1.1 class-scoped fixture deprecation/setup failures. Pinning pytest 8.4.2 resolved them. No upstream source was patched and warnings were not suppressed. The Git client rewrites clone remotes to SSH in this environment; the canonical HTTPS source is linked above. These reproducible dependency constraints matter to future audit reruns.

## What the suites actually prove

The suite has substantial behavior and exact-XML assertions for paragraphs/runs, fonts/styles, sections, headers/footers, table grids and merges, image parsing, OPC packaging and current comment APIs. The table tests distinguish physical rows/cells and logical coordinates; comments cover author metadata, IDs, iteration and creation. BDD adds public document workflows rather than relying only on mocks.

Many tests assert private Python wrappers, collection identities and XML descriptor mechanics. Preserve each applicable semantic case and boundary while expressing it through the TypeScript engine and original memfs fixtures. Disk snippets and binary files must be reduced into original in-memory equivalents.

Coverage gaps include numbering XML (especially low relative to the rest), enum-base behavior and some shape/simple-type/OPC branches. Track changes, complete floating-image editing, fields, all Office extensions and sandbox/security correctness are not established by these pass counts.

This is legitimate, broad unit coverage of the implementations. It is not full OOXML specification coverage, visual fidelity proof or evidence that the new utilities work. No TypeScript tests have been written by this planning task.

## Test-case accounting

[The inventory](upstream-test-inventory.json) records every collected unit variant and expanded BDD example with source location and source commit. All adaptation rows are honestly `unmapped_not_implemented`; collecting a case does not claim to have ported it. [The evidence](upstream-test-evidence.json) contains exact coverage denominators and per-file summaries.

Implementation must map every source row to original TS tests, preserving edge values and expected behavior. A many-to-one mapping requires explicit equivalence; Python-only mechanics need an observable replacement or a reasoned architecture-only disposition. Unsupported public functionality remains a visible scope gap and cannot be silently omitted or counted as parity. New format/sandbox/large-file tests supplement the upstream cases.

## Unit distribution

| Directory          | Collected cases |
| ------------------ | --------------: |
| `tests`            |             390 |
| `tests/dml`        |              31 |
| `tests/image`      |             138 |
| `tests/opc`        |             167 |
| `tests/opc/parts`  |               2 |
| `tests/oxml`       |             171 |
| `tests/oxml/parts` |               6 |
| `tests/oxml/text`  |               9 |
| `tests/parts`      |              61 |
| `tests/styles`     |             184 |
| `tests/text`       |             450 |

## Lifecycle

Temporary upstream checkouts and their binary fixtures are research/QA inputs, separate from downloaded publisher documents. Keep them out of the product and canonical TS unit fixtures. They may be deleted after adaptation/QA when no active campaign needs them; retain pinned provenance, case mapping, legally required notices, original regressions and concise evidence.
