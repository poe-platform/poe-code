# Shared master editing

Implement the requested F11 master editing slice against the PPTX format and
shared office CLI/SDK contracts. Do not run the whole pipeline, edit READMEs,
publish, push, or include disposable corpus bytes in commits.

## Ownership

- Domain worker: new master domain implementation/tests and package exports.
- Command worker: PPTX engine, schemas, and command tests.
- Adapter worker: safe-bash command acceptance tests and necessary adapter fixes.
- Root: integration review, research accounting, draft usage, QA and local commits.

This delegation follows `packages/safe-bash/AGENTS.md`. No other worker owns these
assigned changes. Existing unrelated work remains untouched.

## Acceptance and TDD

First establish missing behavior with failing original in-memory tests. Author
masters and supported master shapes, edit selected text and backgrounds, and
reassociate layouts without materializing inherited values onto slides. Require
explicit shared ownership, list all dependent slides, retain explicit overrides,
and distinguish shared themes from shared masters. Exercise multiple masters,
layouts with no slides, missing and ambiguous owners, and failed publication.
Read-only inspection must not create definitions. CLI and SDK share domain code.

Use `docs/pptx/upstream-test-audit.md`, both inventories and the canonical case
ledger for individual parameter/BDD evidence. Research identities remain solely
in research and standalone notices. Operation evidence is not whole live-model
API parity; inherited/underscore-prefixed public APIs remain visible obligations.

## Agent-executed QA

1. Run the maintained PPTX workspace tests and lint; build its declared closure.
2. Run focused safe-bash PPTX command acceptance checks, with adapter scope lint.
3. Verify hashes of available template documents in the corpus manifest before
   reading them. Apply supported shared master edits using explicit admitted
   bytes. Independently inspect changed XML and retained slide/theme bytes.
4. Reduce meaningful findings into small original in-memory regressions.
5. Capture actual master command help/results with the maintained screenshot
   runner and visually inspect the PNG. Keep captures in ignored QA storage.
6. Review exact owned diffs, stage named files, and make atomic Conventional
   Commits on main after checks pass. Report local hashes separately from remote
   delivery; no push or release is authorized.

## Verification receipt

Initial red evidence: two new safe-bash master cases fail with unsupported
operation; the 24 existing cases in that file pass. Domain and engine owners are
adding original failing tests before implementation.

Disposable inputs admitted by exact manifest SHA-256: the 1,202,514-byte
IXPE template, 213,136-byte WWL template and 8,141,046-byte SEWP training deck.
The last contains two masters. Root applied master renames to all three and
compared every uncompressed part: only the selected master XML changed. The
two-master deck reported slides 2–18, excluding slide 1. Root also added a text
box, changed its position/text and set a solid background on the IXPE and SEWP
inputs; only the selected master changed, with slide/theme/media bytes retained.
These are structural preservation checks, not rendering certification.

The adapter owner captured and inspected actual help and result screenshots via
the maintained generic `npm run screenshot` route (there is no root `poe-code`
PPTX command). Root independently viewed the result image. Captures live at
`.cache/pptx-corpus/qa-master-help.png` and `qa-master-result.png`; both are ignored.
No fixture, capture or QA script enters the product or unit suite.

Independent review found and reduced four defects to original memfs CLI cases:
numeric shape name/identity confusion in two arrangements, literal `]]>` text,
and a master name resembling another master's part URI. A further root review
found signed-position SDK/CLI drift; exact negative units and half-away-from-zero
rounding now have original regressions. Background effects/extensions and
inherited transforms versus explicit zero-valued overrides have independent
XML assertions. Resource limits reject oversized names and shape arrays before
markup construction or array expansion.

Validation checkpoints:

- `npm test --workspace=pptx`: final run passed 38 files and 1,053 cases,
  including 24 master-domain and 14 master-command cases.
- `npm run build:workspaces -- --workspace=pptx`: all three maintained builds
  passed, derived from declarations.
- `node --import tsx --test packages/safe-bash/tests/commands/pptx/create.test.ts
  packages/safe-bash/tests/commands/pptx/selectors.test.ts
  packages/safe-bash/tests/commands/pptx/inventory.test.ts`: 75 cases passed.
- `npm run lint --workspace=pptx`: final source lint, source types and test types
  passed, including the final admission changes.
- `check_spec.py docs/specs/pptx.md`: passed, zero warnings. The whole-format
  `Implemented Through: Not applicable` remains unchanged.
- `npm run lint:eslint`: passed with zero errors/warnings, 11,889 configured
  files linted and all 25 authenticated receipts. No full pipeline was executed.

The research ledger retains 643 unit variants, 194 BDD examples and 413 API
records as a relevance superset. 116 rows have supplementary original operation
evidence. These are not 837 ported cases: full live-model/advanced formatting and
adjacent behaviors remain explicit gaps, including creating background getters,
collections, inherited members, enums and untested public API obligations.

## Local delivery

`38b22eefe` contains the byte SDK, original domain tests and research accounting.
The following atomic commit contains command routes/schemas, signed coordinate
parity, CLI regressions, usage and reconciled contracts. Both are local on main.
No push, remote-main verification or release was requested or performed.
