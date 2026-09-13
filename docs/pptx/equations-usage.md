# Equation operations (draft)

These are local implementation examples, not a release or installation claim.
All file access belongs to the caller-configured virtual filesystem.

```sh
pptx equations list slides.pptx --json
pptx equations get slides.pptx --slide 2 --shape Formula
pptx equations add slides.pptx --slide 2 --shape Formula --file equation.xml --output updated.pptx
pptx equations add slides.pptx --slide 2 --shape Formula --file equation.xml --dry-run --json
pptx schema equations add
```

`list` inventories stored OMML, including preserved branches. `get` requires one
matching equation and emits standalone OMML; ambiguous matches fail. JSON includes
literal token text, namespace-complete markup, owner locations and whether the
equation is within the insertion subset. A false `supported` value means the
existing markup is readable/preserved but cannot be supplied for authored insertion.

Locations select containing shapes. Paragraph/equation ordinals are informational;
use `list --json` to extract multiple equations from the same shape. `get` rejects
such a multiple match. Whole-text replacement that would delete an equation or
fallback fails with `unsupported-edit`.

Insertion appends one caller-authored equation to the last paragraph of exactly
one selected slide text shape. The supported subset is nonempty literal runs,
fractions and subscript/superscript structures under `oMath` or `oMathPara`.
Formatted runs, unknown extensions and other structures are not accepted for
insertion. Existing unsupported equations are preserved. No formula evaluation,
typesetting, font discovery or synthesized visual fallback occurs. An inserted
equation's compatibility fallback is empty; older readers may omit it.
Authored namespaces must match the target presentation's Strict/Transitional
dialect; mismatches are rejected without conversion. Insertion into a shape-level
alternate-content branch is rejected to protect existing fallback synchronization.

An original minimal input is:

```xml
<m:oMath xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math">
  <m:r><m:t>3 + 4</m:t></m:r>
</m:oMath>
```

The public operation SDK exposes asynchronous `readEquations(input, options,
context)` and `mutateEquations(input, "add", { ...selection, file }, context)`.
`input` and `file` accept explicit admitted binary input; `context` supplies byte,
archive, XML and relationship limits and optional capability I/O/cancellation.
Mutation returns bytes for caller-owned publication. `inventoryEquations` reads
an already parsed bounded XML part, and `validateAuthoredEquation` validates a
standalone byte document against explicit XML limits. These functions share the
CLI's domain implementation.

Equation set/remove and a live equation object model are not implemented. This
bounded operation surface does not claim complete public-model parity.
