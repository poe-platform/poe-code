# PPTX semantic validation

## Scope and ownership

Implement the presentation-structure validation step only. Root owns
`packages/pptx/src/validation.ts`, its test, this plan, and
`docs/pptx/semantic-validation-case-map.json`. No safe-bash file is edited;
its scoped delegation requirement is therefore not activated. Root wiring,
README files, existing planning edits and research inputs remain untouched.
No pipeline execution, push or release.

Read root AGENTS.md, the presentation spec, shared Office command/SDK contracts,
both upstream audits/inventories, current public API/language mappings and the
corpus manifest. Existing inventory/ledger rows retain their exact parameter and
BDD identities. The new research supplement records related cases individually;
none is falsely promoted from graph validation to implemented model behavior.
This step adds original semantic cases absent from the upstream validator surface.
No source or fixture material is copied; standalone legal notices stay unchanged.

## Implemented semantic rules

- `main-part`: exactly one internal package office-document relationship and one
  macro-free presentation/template/show main part, agreeing on target identity.
- `content-types`: every physical member has a content type; relationship parts
  use the relationship content type. Known presentation types select expected roots.
- `relationship-targets`: internal relationship targets exist, using the existing
  canonical OPC graph reader. Malformed OPC/XML admission still throws OfficeError.
- `required-structure`: expected namespace/root for recognized presentation parts,
  one cSld/spTree on drawing parts, required nonvisual containers and cNvPr,
  presentation notesSz, master color maps and singleton lists where inspected.
- `slide-ids`: unsigned lexical IDs in 256..2147483647, unique by numeric value,
  unique listed slide targets and resolvable typed relationship IDs.
- `shape-ids`: unsigned 32-bit IDs unique within each owning part's drawing tree,
  including nested groups. Independent parts may reuse IDs.
- `master-layouts`: master/layout ID lists and types, slide-to-layout and
  layout-to-master cardinalities, reciprocal master/layout associations and
  listed outgoing layouts. Master/layout IDs occupy 2147483648..4294967295.
- `note-associations`: slide/notes reciprocal ownership, at most one notes part
  per slide, exactly one owning slide and notes-master relationship per notes part,
  and typed presentation notes/handout-master list references.
- `timing-references`: local cTn IDs, tn references, spTgt and build-list shape
  references, including spid-bearing timing descendants.
- `connector-references`: local start/end target IDs and unsigned connection-site
  indices. Geometry-specific connection-site existence is not checked.

Reports list implemented rules and findings and explicitly return
`schema: not-checked`. A clean report is not full schema validity. The validator
never rewrites bytes. Unknown unrelated parts remain opaque and unchanged.
MCE selects the effective branch; ignored content does not contribute IDs.
Known required unsupported namespaces retain the compatibility layer's explicit
unsupported-profile refusal. Extension schemas, all DrawingML structures,
full child sequencing/attribute constraints, geometry sites and extension-specific
references remain outside this semantic subset. No schema or rendering claim.

There is no exposed Presentation model, validate command or pptx command adapter
in the current tree. This function remains package-internal, like existing OPC
primitives, until the planned operation SDK and command integration. Therefore
no public schema/capabilities contract or model API is promoted. No visual CLI
changes; screenshots would not validate this internal layer.

## TDD and checks

1. Author independent malformed examples for every rule and valid acceptance
   cases in memfs. Run the focused suite before implementation.
2. Implement bounded read-only inspection using existing XML/MCE and OPC parsers.
3. Exercise real archive admission once; isolate semantic cases with a memfs
   PackageReader to avoid repeating already-tested ZIP work.
4. Run maintained package tests/lint and the selected workspace build closure.
5. Read only a manifest corpus entry, verify SHA-256 before and after inspection,
   and record refusals separately from semantic/schema results.

Observed red evidence: initially missing validator module; later positive-deck
cases caught normalized content-type lookup errors. Additional failing cases
caught a dangling-master lookup exception and acceptance of a layout absent from
its master's list. Each was fixed without weakening the expected rule assertion.

Verification: final maintained package tests passed 404 tests in 12 files,
including 40 validator cases (about 125 ms). Package lint includes ESLint and
both production/test TypeScript checks. Selected workspace build closure includes
pptx and office-package, with no full pipeline execution.

## Corpus QA receipt

Read the first manifest entry, `.cache/pptx-corpus/IXPE-Presentation-Template.pptx`,
through explicitly supplied bytes and bounded archive/validation limits.
The 38-member archive admitted successfully. Semantic validation refused it with
`unsupported-profile` because its required namespace content is outside the
existing compatibility interpreter's supported namespace set. It is neither a
semantic pass nor an independently established malformed document. Keep the
limitation visible; do not bypass compatibility or claim understanding by adding
all namespaces to the understood set. An original tiny required-attribute
regression records this refusal boundary without downloading a unit fixture.

Before/after SHA-256:
`885e923f148cdf4680372abe54496c824ab3a2a2d8a59fd9703d66e0aeb1164c`.
Corpus bytes were unchanged, not shipped, not staged, not deleted. No renderer,
screenshot, schema validator, native product runtime or network was used.
