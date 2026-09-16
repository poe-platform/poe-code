# Bounded equation domain implementation

The equation domain is owned by this task in `packages/pptx/src/equations.ts` and its original unit tests. Command/schema integration belongs to its delegated integration owner. No README edits, host I/O, downloads, rendering or evaluation are introduced.

## Contract and research

Read the root instructions, equation F41 contract, shared office contracts and the existing upstream API/test audit documents. The inventories have no equation or OMML entries; this slice adds original contract cases rather than attributing equation coverage to unrelated reference cases. Existing public API obligations are not reclassified or hidden.

Read extraction returns standalone namespace-complete OMML, literal text in structural order and whether it belongs to the bounded authored subset. Unknown extension content remains extractable and is never normalized. Insertion supports one explicitly named shape on a selected slide or an opaque selected object token and appends to its last text paragraph before end-paragraph properties. The document is parsed with supplied XML budgets and DTD/entity declarations are prohibited. The supported authored subset comprises nonempty equations/paragraphs, literal runs, fractions and subscript/superscript structures; unexpected attributes, unsupported child ordering and mixed non-text content fail closed. Existing formatted math can be extracted even when not admitted for insertion.

Tokens identify containing shapes; list returns all equations in that shape, and get fails on ambiguity. Paragraph/equation ordinals are informational.

Insertion uses a markup-compatibility choice with a drawing math wrapper and an empty fallback. It does not generate a visual fallback. Existing text, equations, fallback branches, namespace bindings and unrelated package parts are retained. Set/remove remain unsupported.

## Validation receipt

- Initial focused suite failed on the missing equation module before production implementation.
- Twenty-two original in-memory XML cases cover namespace aliases and strict namespaces, decoded literal text, extensions, standalone extraction, fractions/scripts, malformed structure/order, unwanted attributes, raw mixed text, processing instructions, DTD/entity attempts, invalid roots, multiple documents and resource bounds.
- Source and test TypeScript checks and owned-file ESLint pass.
- A disposable corpus QA finding (shape-level compatibility choices hidden by effective text reading) was reproduced as one original memfs package regression. Equation reads now traverse all raw XML branches rather than effective text bodies. Shape-level compatibility branch insertion is rejected to prevent accidental fallback edits.
- SDK/CLI integration and memfs roundtrip coverage are delegated to the command owner; parent owns corpus QA and text/slide preservation regressions.

## QA procedure

Use manifest-admitted disposable corpus files only in the parent QA session. Inventory equations, perform unrelated text and slide operations, and compare equation/fallback content independently. Never ship downloaded fixtures. Convert any meaningful finding to a small original regression in the owning test file.

## Dialect admission follow-up

Four original regressions first failed, demonstrating that mixed math/DrawingML dialects and both directions of package/math dialect mismatch were previously admitted. Authored runs must now use the DrawingML namespace matching their mathematical namespace; insertion additionally requires authored math and the target paragraph to match the presentation dialect. No namespace conversion occurs. Matching Strict and Transitional insertion each round-trip through the original in-memory package cases. Twenty-six domain cases and ten command cases pass; domain cases use the existing zero-delay timer seam and complete in under 200 ms in the focused run.
