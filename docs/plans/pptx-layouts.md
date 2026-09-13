# Layout and placeholder editing

Implement the requested F12 slice against `docs/specs/pptx.md` and the shared
office command/SDK contracts. No whole pipeline, README edits, push or release.

## Ownership

- Domain worker: `layouts.ts`, domain tests, package exports and minimal shared
  master helpers needed to reuse validated package editing.
- Command worker: command engine/schema and original command acceptance tests.
- Adapter worker: safe-bash PPTX adapter/acceptance tests and visual CLI QA.
- Root: integration review, provenance accounting, usage draft, disposable corpus
  QA, maintained checks and atomic local commits.

The scoped safe-bash instructions require delegation. These assignments supersede
historical assignments; unrelated work is preserved and never staged.

## Acceptance

Use failing original memory-only tests before implementation. Manage unique layout
IDs and both master relationship directions. Require explicit shared/layout scope
for shared changes. Apply layouts with required deterministic `type-index` or
`reject-unmatched` policy; reject ambiguity. Retain every local object and its
content/formatting. Test absent type/index defaults, local zero-valued overrides,
inherited values, unused/used layout removal and dependent-slide reporting.
CLI and byte SDK must invoke the same domain operations. Public live-model
members and source parameter/BDD obligations remain visible in research even
where the byte-operation slice does not yet implement them.

## Agent-executed QA

1. Run focused red/green tests, then maintained PPTX workspace tests/lint/build.
2. Run maintained safe-bash PPTX acceptance checks and adapter lint as applicable.
3. Read only available disposable files listed in the corpus manifest, admitting
   their exact SHA-256 before use. Exercise layout application and shared edits.
   Independently compare uncompressed parts, slide content and relationships.
4. Reduce any meaningful finding to a small original memory-only regression.
5. Capture actual command help/results with the maintained screenshot runner;
   inspect the PNG. Keep outputs in ignored corpus QA storage.
6. Reconcile every selected parameter and expanded BDD scenario individually,
   with exact language/security mappings and honest unimplemented obligations.
7. Stage only explicit owned files and commit atomic improvements on main with
   Conventional Commits. Report local hashes; never push or release.

## Verification

TDD began with missing domain imports and unsupported layout commands. Original
memory-only regressions cover sparse indexes on shape/picture/frame placeholders,
all four latent-placeholder pairs, zero/one/two layout counts and all four
dependent-slide membership vectors. The final review reduced graphic-frame
transform lookup and subtitle-to-master-body inheritance into failing original
cases before fixing them. Coordinate-pair authoring and rich-placeholder text
coercion also have original regressions. Inspection resolves per-coordinate
layout/master/null provenance without materializing inherited values.

Corpus QA admitted exact manifest hashes for the IXPE and WWL templates and the
SEWP provider training deck. They contain respectively 5/11/9 layouts and
23/58/27 inspected placeholders. Applying a selected layout under `type-index`
changed only slide relationship parts (4/1/19 slides). Every uncompressed slide,
theme, media and unrelated part retained its bytes. Creating, editing and removing
a temporary unused layout restored each original layout count. This establishes
structural preservation, not renderer-certified visual fidelity.

The adapter worker captured real shell help and missing-policy errors using the
maintained generic screenshot runner. Root independently inspected both ignored
PNGs at `screenshots/pptx-layout-help.png` and
`screenshots/pptx-layout-policy-error.png`. The error uses stderr and status 2.
No downloaded fixture, screenshot or QA script is committed.

Maintained verification:

- `npm test --workspace=pptx`: 41 files, 1,106 cases passed after final exact
  placeholder default variants. New coverage is 4 domain + 39 independent
  regression + 10 command cases.
- `npm run lint --workspace=pptx`: source lint and both TypeScript checks passed.
- `npm run build:workspaces -- --workspace=pptx`: declared three-build closure
  passed after the final correction; all five byte functions resolve through
  the built workspace package's public export.
- Safe-bash maintained reporter on the three PPTX command files: 81 cases passed,
  including six new original memfs shell cases. No adapter source change needed.
- Specification checker: passed with zero warnings.
- `npm run lint:eslint`: passed with zero errors/warnings, 11,893 configured
  files linted and all 25 authenticated boundary receipts.

`docs/pptx/layout-case-accounting.json` retains a complete-module relevance
superset of 378 unit variants, 175 expanded BDD scenarios and 176 API records.
47 rows have supplementary original byte-operation evidence; that is not 47
fully ported live-model cases. Exact parameter/scenario records and J01–J10
language/security distinctions remain linked. Live properties, enums, inherited
interfaces, collection protocols and rich-content invalidated handles remain
explicit pending obligations. No type is excluded because it starts with `_`.
The standalone existing MIT research notice remains applicable to the ledger.

The command register and usage drafts distinguish available direct byte/command
operations from proposed typed-batch and full model APIs. The whole-format spec
remains Proposed with `Implemented Through: Not applicable`; this slice cannot
certify the entire format contract.

## Local delivery

`e107601d0` contains the layout domain, independent tests and case accounting.
The next atomic commit contains command routes/schema, adapter acceptance and
reconciled usage/contracts. Neither is pushed.
