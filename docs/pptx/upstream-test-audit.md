# PPTX Upstream Test Audit

Status: Research complete for the pinned baseline; TypeScript adaptation not started.

## Pinned source

- Repository: [https://github.com/scanny/python-pptx](https://github.com/scanny/python-pptx)
- Commit: `278b47b1dedd5b46ee84c286e77cdfb0bf4594be`
- Temporary clone: `/tmp/pptx-upstream-review`
- License: MIT, with the original copyright and permission notice retained in [the research notice](upstream-license-notice.txt). Any substantial copied/derived material needs the notice retained in an appropriate standalone legal file.
- Product code, code comments, test names, fixtures and CLI output must contain no reference-project identities. Reference links belong in plans/research and legally required notices.

## Executed results

| Measure | Result |
| --- | ---: |
| Collected unit cases, including parameter variants | 2700 |
| Unit passes | 2700 |
| Unit failures / errors / skips | 0 / 0 / 0 |
| Statement coverage | 11,246 / 11,508 (97.72%) |
| Branch coverage | 1,327 / 1,466 (90.52%) |
| Coverage-excluded lines | 200 |
| BDD feature files | 54 |
| Expanded BDD scenarios/examples | 973 |

Unit command: `python -m pytest tests --cov=pptx --cov-branch --cov-report=json --junitxml=... -q`. A temporary collection plugin recorded actual node IDs; it did not change execution. BDD command: `python -m behave --format progress --tags=-wip`, matching upstream tox policy; the recorded run reported zero skipped scenarios. BDD was executed separately and is not included in the unit coverage percentage.

Environment: isolated Python 3.11.13 virtualenv, pytest 8.4.2, pyparsing 3.2.3, coverage 7.16.0, behave 1.3.3, lxml 6.1.3 and Pillow 12.3.0. Editable packages point to the pinned clones. Product code does not use this environment.

The first run with pyparsing 3.3.2 failed collection because the suites treat its API-deprecation warnings as errors. Pinning pyparsing 3.2.3 exposed pytest 9.1.1 class-scoped fixture deprecation/setup failures. Pinning pytest 8.4.2 resolved them. No upstream source was patched and warnings were not suppressed. The Git client rewrites clone remotes to SSH in this environment; the canonical HTTPS source is linked above. These reproducible dependency constraints matter to future audit reruns.

## What the suites actually prove

The suite has substantial behavior and exact-XML assertions for slide/notes graphs, text formatting, tables/merges, pictures/cropping, groups/connectors/freeforms, DrawingML styles, charts/axes/series/data labels, chart workbook generation, media/movie metadata and OPC packaging. For example, picture tests cover absent crop attributes, negative crop and values greater than one; chart data tests cover category/XY/bubble data and inherited number formats. BDD adds public API workflows, including media and text fitting.

Many tests also assert private Python proxy classes, descriptors and mock call paths. Their meaningful input/output behavior should be adapted to the TypeScript API without reproducing Python internals. Text-fitting cases assume font metrics and need an explicit portable metrics capability or a visible scoped limitation. Chart-workbook tests reveal a substantial data synchronization requirement, not merely picture-like chart preservation.

Coverage gaps include enum-base behavior, text-layout/font-fit paths and some API/shape branches. Timelines, Morph, complete SmartArt editing, modern comments, Strict/MCE adversarial preservation and sandbox publication are not established by these pass counts.

This is legitimate, broad unit coverage of the implementations. It is not full OOXML specification coverage, visual fidelity proof or evidence that the new utilities work. No TypeScript tests have been written by this planning task.

## Test-case accounting

[The inventory](upstream-test-inventory.json) records every collected unit variant and expanded BDD example with source location and source commit. All adaptation rows are honestly `unmapped_not_implemented`; collecting a case does not claim to have ported it. [The evidence](upstream-test-evidence.json) contains exact coverage denominators and per-file summaries.

Implementation must map every source row to original TS tests, preserving edge values and expected behavior. A many-to-one mapping requires explicit equivalence; Python-only mechanics need an observable replacement or a reasoned architecture-only disposition. Unsupported public functionality remains a visible scope gap and cannot be silently omitted or counted as parity. New format/sandbox/large-file tests supplement the upstream cases.

## Unit distribution

| Directory | Collected cases |
| --- | ---: |
| `tests` | 321 |
| `tests/chart` | 955 |
| `tests/dml` | 186 |
| `tests/enum` | 27 |
| `tests/opc` | 157 |
| `tests/oxml` | 170 |
| `tests/oxml/shapes` | 41 |
| `tests/parts` | 129 |
| `tests/shapes` | 465 |
| `tests/text` | 249 |

## Lifecycle

Temporary upstream checkouts and their binary fixtures are research/QA inputs, separate from downloaded publisher documents. Keep them out of the product and canonical TS unit fixtures. They may be deleted after adaptation/QA when no active campaign needs them; retain pinned provenance, case mapping, legally required notices, original regressions and concise evidence.
