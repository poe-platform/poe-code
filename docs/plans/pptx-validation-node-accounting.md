# PPTX validation node accounting

Root owns this plan and only packages/pptx/src/{xml,validation}.ts and their
adjacent tests. No safe-bash changes or delegation are needed for this internal
package correction. Preserve other work; commit locally on main only.

## Validated defect and correction

Spec section 7 requires actual XML node accounting. The parser already counts
text, CDATA, comments, processing instructions and elements. Semantic validation
instead recounted only elements after accepting each part's root, allowing
non-element nodes and wrong-root parts to escape its cumulative limit.

Expose the parser's immutable nodeCount on its internal XmlPart result. Pass
only the remaining node allowance when parsing the next recognized presentation
part, and charge its count before checking its namespace/root. This also removes
an unnecessary element traversal. A depleted allowance refuses the next parse.

Five original memfs regressions failed before the fix: cumulative text, comments,
CDATA, processing instructions and wrong-root parts. Each uses two individually
admissible parts whose combined work exceeds the allowance. An independent
six-node XML example accepts six and rejects five, checking the parser receipt.
No expected count comes from the implementation under test.

## Evidence and boundaries

Consulted root AGENTS.md, the format and shared Office specs, both upstream
audits/inventories, language mappings and corpus manifest. These resource-budget
cases supplement the upstream behavioral inventory; no upstream model/API or BDD
row is promoted to implemented. No upstream implementation or assets were copied,
so no additional derived-material notice is required. Existing research/legal
notices are preserved.

This does not complete the proposed utility. XML counts here cover recognized
presentation parts, not content-type/relationship parsing or all operation work.
A shared operation ledger, batch/merge/diff accounting, slide/shape/media ceilings,
cooperative cancellation/yielding and complete public API coverage remain required.
The internal validator is not exposed through the package public index or a CLI,
so there is no new public route or visual change to verify in this commit.
README files, product branding, root wiring and adapters are untouched.

No corpus downloads or fixture changes were needed: the defect is reproduced
with small original in-memory inputs. No rendering/real-world QA claim is made.
The manifest remains the authority for later disposable corpus campaigns.

## Verification

- Red: five newly added validation cases failed with no expected exception.
- Green: npm test --workspace=pptx passed 410 tests in 12 files.
- npm run lint --workspace=pptx checks ESLint and production/test TypeScript.
- npm run build:workspaces -- --workspace=pptx passed the selected pptx and
  office-package build closure.
- No whole pipeline, push or release.
