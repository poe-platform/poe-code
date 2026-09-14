# DOCX Upstream Test Audit

Status: Research complete for the pinned baseline; TypeScript adaptation not started.

## Pinned source

- Repository: [https://github.com/python-openxml/python-docx](https://github.com/python-openxml/python-docx)
- Commit: `e45454602b53e8e572b179ccf1c91093ec9f4ed7`
- Temporary clone: `/tmp/docx-upstream-review`
- License: MIT, with the original copyright and permission notice retained in [the research notice](upstream-license-notice.txt). Any substantial copied/derived material needs the notice retained in an appropriate standalone legal file.
- Product code, code comments, test names, fixtures and CLI output must contain no reference-project identities. Reference links belong in plans/research and legally required notices.

## Executed results

| Measure | Result |
| --- | ---: |
| Collected unit cases, including parameter variants | 1609 |
| Unit passes | 1609 |
| Unit failures / errors / skips | 0 / 0 / 0 |
| Statement coverage | 7,407 / 7,612 (97.31%) |
| Branch coverage | 884 / 996 (88.76%) |
| Coverage-excluded lines | 240 |
| BDD feature files | 67 |
| Expanded BDD scenarios/examples | 650 |

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

| Directory | Collected cases |
| --- | ---: |
| `tests` | 390 |
| `tests/dml` | 31 |
| `tests/image` | 138 |
| `tests/opc` | 167 |
| `tests/opc/parts` | 2 |
| `tests/oxml` | 171 |
| `tests/oxml/parts` | 6 |
| `tests/oxml/text` | 9 |
| `tests/parts` | 61 |
| `tests/styles` | 184 |
| `tests/text` | 450 |

## Lifecycle

Temporary upstream checkouts and their binary fixtures are research/QA inputs, separate from downloaded publisher documents. Keep them out of the product and canonical TS unit fixtures. They may be deleted after adaptation/QA when no active campaign needs them; retain pinned provenance, case mapping, legally required notices, original regressions and concise evidence.
