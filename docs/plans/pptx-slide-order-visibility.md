# Slide order and visibility

Scope: F07 move, rename and hide/show through the byte SDK and shared CLI operation
engine. Keep existing slide IDs and part names, preserve requested selection order,
reject duplicate resolutions, and use the final one-based block position after
removing selected slides. Names are labels, not identity keys. No pipeline, README
edit, push or release.

Ownership: root owns `slides.ts`, `index.ts`, XML permutation support, their tests,
this plan, scoped research accounting and draft usage. Delegated `cli_slides` owns
command-engine/schema/command tests and the existing registered safe-bash
`tests/commands/pptx/create.test.ts`. No safe-bash implementation change is needed.
Unrelated dirty/untracked work is excluded from staging.

TDD evidence: XML permutation tests initially failed with missing method; mutation
SDK cases initially failed with missing export; command cases initially rejected
unknown operations. A targeted regression additionally reproduced an out-of-scope
empty query incorrectly accepted with `allowEmpty`; resource/scope admission now
precedes empty-match handling. XML node movement uses original spans under the same
parent, retaining namespace bindings, comments, attributes and whitespace.

Original memfs tests use independent ZIP and XML assertions. They cover reversed
and nonconsecutive blocks, all-slide reversal, final destination bounds, exact
IDs including 2147483647, filenames differing from list order, ignored extension
attributes, duplicate labels, absence/clearing, visibility true/false, stale tokens,
no-op exact archive bytes, protection/macro refusal and malformed visibility.
Unchanged notes, internal/external relationships and animation XML are compared
byte-for-byte. Timer yielding alone is mocked to `setImmediate` in the new domain
suite; ZIP/XML/validation/mutation behavior is real. No downloads or host files
are required by these unit tests.

Research authority: `docs/pptx/upstream-test-audit.md`, upstream test/API inventories,
API audit, canonical case ledger and language mappings. Supplemental research is
`docs/pptx/slide-order-case-accounting.json`; original source identities stay there.
The existing standalone `slide-insertion-notice.txt` retains the MIT notice for
reused research evidence; product code and test assets are original. Source
collection/model methods remain distinct from byte-operation evidence. Inherited
and underscore-prefixed public members retain visible obligations, not privacy
exemptions. No whole-model or full format conformance is claimed.

Contract reconciliation: shared direct `--slide N` and `--select TOKEN` remain
unchanged. Advanced ordered selections use additive `--selection-json` with an
explicit slide-query or array schema, mutually exclusive with simple selectors.
It mirrors operation-SDK selection support without generic evaluation. Direct
`slides set` accepts name/hidden/position, and `slides move` requires position.
Layout/background changes are outside this increment. Missing selectors fail even
for singleton decks. Empty mutations require `allowEmpty`; no fields still fail;
no-op edits retain targeted count with zero effects and unchanged bytes.

## QA procedure

1. Run maintained pptx test/lint and selected workspace build closure, then the
   existing safe-bash pptx test files. Review help/result schemas and direct/SDK
   parity. Do not run the whole pipeline.
2. Read manifest-listed cached template bytes only after exact SHA-256 verification.
   Use immutable originals and owned outputs prefixed `.cache/pptx-corpus/qa-slide-order-`.
   Check Git ignores all disposable outputs. Run move and visibility edits through
   the public byte SDK, with explicit bytes and bounded context.
3. Independently unzip original/output, compare exact slide-ID/relationship order,
   inspect effective visibility and compare every unrelated member byte-for-byte.
   Structural QA does not establish application-rendered fidelity. Reduce any
   meaningful new failure to original memfs regression cases.
4. Capture actual engine help and human mutation output with the maintained generic
   screenshot runner (pptx has no root poe-code command), inspect PNGs, and retain
   them only in ignored cache. Record outcomes below before local atomic commits.

## Validation receipt

- `npm test --workspace=pptx`: 23 files, 739 tests passed; the new domain suite
  has 27 original cases and takes about 0.5 seconds.
- `npm run lint --workspace=pptx`: ESLint, source TypeScript and test TypeScript passed.
- `npm run build:workspaces -- --workspace=pptx`: maintained selected dependency
  closure passed (office-package, toolcraft-schema, pptx).
- Existing safe-bash pptx create/selectors/inventory tests through `node --import
  tsx --test`: 55 passed, including actual Shell mutation/in-place/pipeline and
  byte SDK parity. Owned-file ESLint passed; no registry changes were needed.
- `git diff --check`: passed. Unrelated work is not staged.

## Disposable QA receipt

Manifest SHA-256 verification passed for IXPE-Presentation-Template.pptx and
WWL-template-1slide.pptx. Moving the final slide to position 1 and hiding it retained
all IDs and part associations. Independent Python ZIP/XML inspection verified
exact IDs/order, effective visibility, and every unrelated member byte-for-byte.
The five-slide template changed only presentation.xml and slide5.xml. The singleton
changed only slide1.xml; its move was an exact no-op. No new corpus finding required
a regression. No downloads occurred and no fixture bytes enter commits or unit tests.

Actual engine help and human dry-run output were captured as ignored text, then
rendered by `npm run screenshot -- --output ... --no-header cat ...`. Both reviewed
PNGs are readable without clipping. The prefix is `.cache/pptx-corpus/qa-slide-order-`;
Git ignore admission passed. This proves structural preservation and terminal
usability, not independent application rendering/playback fidelity.

Research accounting retains 26 unit variants, 8 expanded BDD cases and 93 related
API records. Exact contracts/parameters are cross-linked to the canonical ledger.
Operation evidence is partial for live API obligations; no canonical source row
was falsely promoted to whole-model parity.

## Local delivery

XML permutation support is committed locally as `9c03cdb0e`. The slide-mutation
implementation, paired command/adapter tests and this research/usage receipt form
the following atomic feature commit. Its hash is reported in the completion message
and Git history. No push, remote-main delivery or release was attempted.
