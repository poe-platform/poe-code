# Reconcile presentation language notes with the target register

Scope: one documentation correction on main. Preserve unrelated work and the
existing pipeline-plan edit. No product or README changes, network, reference
runtime, whole pipeline, push or release.

## Evidence and procedure

1. Read root/scoped instructions, the shared CLI/SDK contracts and presentation
   spec. Compare `docs/pptx/api-language-mappings.md` with the existing
   `public-api-map.json` mappings, target rows, D16–D18 and command corrections.
2. Validate each drift before editing: the notes still describe the completed
   target design as a future task, leave extended slicing unresolved, conflate
   property-access failure with invalidated handles, and describe bounded views
   as not yet enumerated. The target register already resolves those points.
3. Update the language notes to the existing exact decisions, including reserved
   parameter binding, slices, notes-placeholder return/fallback types, color/fill
   absence, typed error/code pairs and bounded view declarations. Retain neutral
   model names, distinct command options, source evidence and unimplemented status.
4. Compare every updated claim against the register. Check all error/code pairs,
   source references, collection semantics and the 17 additive view members.
   Confirm shared plural resources, preserving text replacement, schema/capability
   discovery and ordinary/diff exit semantics remain unchanged.
5. Run the installed maintained Prettier formatter and scoped check on the two
   owned Markdown paths, then `git diff --check`. No product tests or screenshots
   apply to this prose-only correction. No authoritative spec is edited.
6. Stage only the language notes and this plan. Inspect the staged diff and commit
   the correction separately from test-case accounting. Report its local commit
   hash without pushing or releasing. Do not rewrite earlier pinned evidence
   merely to make historical statements appear current.

## Results

The notes now match the existing target design. They no longer present resolved
API decisions as future work or confuse a valid handle's unavailable property
with a handle invalidated by replacement. Extended slices preserve the shared
ordinary two-argument call and explicitly specify the already-declared third
argument. D16–D18 and reserved positional binding are recorded in their relevant
language sections. All behavior remains proposed and unimplemented.

## Check results

Passed: scoped maintained Prettier check and `git diff --check`; exact comparison
of all ten error/code pairs with J08; reserved binding and slice checks; the notes
lookup signature and nullable fill return; all 17 additive view members; and
local Markdown links. D16–D18 were compared with the pinned target design.
No product tests or implementation-conformance claims were added.
