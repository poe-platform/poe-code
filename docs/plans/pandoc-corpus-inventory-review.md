# Pandoc corpus inventory review procedure

Scope: `map-upstream-corpus` in pandoc-typescript-safe-bash.md. Preserve the
pre-existing plan edit. This procedure reviews documentation metadata only;
converter implementation and runtime QA are separate tasks.

1. Confirm the research checkout HEAD is
   c9a9a5eed7185783b69043e019c067370dc09615 and authenticate each source/artifact
   hash against that checkout. Never replace the revision with moving HEAD.
2. Review the requested modules and root suite routing. Enumerate individual
   named/property tests, maps and generated helper registrations independently;
   compare exact locators, not merely counts. Check Old writer helper expansion,
   41 bare-link variants, the 10/8/8 list comprehensions, and 45 PowerPoint pairs
   plus eight reference-specific cases.
3. Review every top-level command file using its actual Markdown code-block
   semantics, continuations and block ordinals. Verify opening fence lengths;
   percent signs in stdin/expected TeX must not create tests. Distinguish the two
   nested chapter inputs from automatically registered command files.
4. Authenticate the exact published CommonMark dependency packages selected by
   pinned stack.yaml; enumerate every file-based, inline and property registration,
   preserving fixture-specific license provenance. Compare all 652 CommonMark and 672 pinned GFM example locators and sections
   with the research specifications. Review external dependency-suite coverage
   separately; specification example coverage is not a complete dependency-suite
   claim. Copy no fixture payloads into tests without actual-license review.
5. Check every row has source revision/path/locator, behavior, formats/extensions,
   issue attribution when discoverable, license reference, unique reserved local
   ID, status, reason and contract reference. Exclusions need a specific contract
   justification. Passing requires an implemented original test and maintained
   successful run evidence. Artifact/fixture counts never satisfy that rule.
6. Inspect RTF/EPUB/PDF writer boundaries and recover primary RTF 1.9.1 and EPUB2
   documents through authoritative/versioned sources. Record retrieval hashes
   and actual document rights. Keep research bytes outside the worktree.
7. Check independent safety/chunking/Office/cancellation/font/layout/pagination/
   object obligations; do not claim upstream tests establish these behaviors.
8. Run JSON parsing/schema-field/uniqueness/hash checks and maintained Prettier
   checks for the owned documents. Record outcomes under docs/pandoc. No unit
   or screenshot test is needed for this documentation-only change.
9. Commit only explicitly owned evidence and this procedure. Leave the primary
   task open until completeness/specification gaps close; never stage unrelated
   edits, push, or release for this assignment.

Current outcome: exact selected-suite/command/dependency registration review
completed; structural/hash validation is recorded in
docs/pandoc/inventory-validation.json. Primary-source verification is recorded
separately; no original converter tests are inferred from metadata checks.

External dependency review: all published suite registrations in commonmark 0.3
and commonmark-extensions 0.2.7.1 are assigned. commonmark-pandoc 0.3 declares no
test suite. Archive hashes and source hashes bind research only; zero passing
converter tests are inferred. Exact Pandoc completeness and primary-document
retrieval are handled separately.

Selected Pandoc review: compare named leaf label/line pairs after excluding helper
signatures and group labels. Review givesTOC, EPUB testCase wrapping, the 18
collapse map elements, 174 expanded Old registrations and 98 PowerPoint leaves.
Match every command opening line and ordinal with fence length/indentation rules;
check all body terminators and continuation/stderr/status semantics. Keep all
native-only negative/adaptation cases planned and retain contract justifications
for exclusions. Inventory completion is separate from runtime acceptance.

Standards section review: ignore headings while inside an example body. Match
all CommonMark JSON example ordinals/sections/lines and GFM text example
ordinals/sections/lines exactly, including extension/disabled opening annotations.
Correct reserved locators without importing example text or claiming additional
passing evidence.
