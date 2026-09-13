# Properties and tags integration

Scope: F51 core/custom property editing, presentation/slide tags, explicit UTC
dates, preservation of unknown metadata and custom XML associations, and bounded
property sanitization. Apply the shared office CLI/SDK contracts. This is a
focused implementation task, not execution of the complete feature pipeline.

Ownership: properties_domain owns property/model code and creation integration;
metadata_commands owns tags, schemas, command dispatch and original adapter tests;
metadata_accounting owns source-case/API receipts and draft usage. Root owns public
exports, test registration, integration checks, disposable QA and local commits.
Existing image/media work in shared files is preserved and excluded from staging.

Procedure:

1. Reproduce missing behavior with original in-memory tests before implementation.
   Use independent ZIP/XML assertions and cover duplicate names, empty/absent,
   Unicode bounds, date conversion, unknown namespaces and custom XML retention.
2. Reconcile each relevant inventory variant and expanded BDD scenario. Record
   exact language/security mappings and remaining public model gaps in research.
3. Run maintained pptx tests/lint and selected workspace build. Run the maintained
   safe-bash reporter on the new adapter file and verify literal test discovery.
4. Authenticate a small manifest-listed disposable corpus file. Read/set a core
   property, add a typed custom property and a slide tag; compare unchanged member
   payloads and re-read the changed values. Run property sanitization and verify
   that unrelated members and custom XML relationships survive. Never print private
   corpus metadata or add downloaded assets to tests or commits.
5. Capture and inspect actual CLI help/error screenshots using the maintained
   generic screenshot route with the explicit pptx engine. Keep images in .cache.
6. Review owned diffs, stage explicit owned files/hunks, and commit atomic verified
   improvements on main with Conventional Commits. Do not push or release.

Validation results and local commit receipts will be appended after execution.

Executed corpus QA: authenticated the two smallest available manifest inputs by
SHA-256 (`CERN-job-opp-250925.pptx`, `WWL-template-1slide.pptx`). Set a core title,
custom boolean false, explicit modified timestamp and slide-one empty-valued tag.
Of 29 and 43 original members respectively, 24 and 38 retained identical payloads.
The five expected edits were content types, package relationships, core properties,
slide one and its relationships. Only custom properties and one tag part were
added. Sanitization removed known properties while preserving the tag and all
non-property members byte-for-byte. The live model converted an explicit Date
with milliseconds to UTC whole seconds. No input or QA output file was written.

Focused registration lint: guarded API, unchanged root configuration, 25 verified
receipts, one subject, zero errors/warnings, matched 2,009 opens/closes, complete
receipts and no guard failure. This is changed-file evidence, not full-root lint.

Inspected `.cache/pptx-properties-tags-help.png`, captured through the maintained
generic screenshot command and actual Shell/pptx plugin. Help shows plural
resources, type/date rules, tag scope and sanitization limits; missing destination
produces a concise usage diagnostic and exit 2. All text is visible and legible.
The first QA invocation omitted Shell's required explicit filesystem; supplying
MemoryFileSystem corrected the QA invocation without a product change.

Final verification:

- Maintained `npm run test --workspace=pptx`: 167 files, 4,228 tests passed.
  This checkpoint preceded three final property variants; the final focused run
  of properties, creation-properties, tags and command-metadata passed all 58 cases.
- `npm run lint --workspace=pptx` passed, including production and test typechecks.
  An initial test-only Uint8Array inference error was fixed with an explicit type.
- Final `npm run build:workspaces -- --workspace=pptx` passed the declared closure.
- The maintained safe-bash reporter passed the metadata adapter test, including
  real binary property/tag edits and independent ZIP/XML assertions. An initial
  independent assertion omitted an XML namespace declaration; the corrected
  assertion checks the declaration and semantic attributes separately.
- Three focused maintained discovery/type-accounting tests passed. Source names
  are absent from the owned product code/tests; standalone legal notices remain.
- Final guarded adapter lint passed: 7,027 subject bytes, zero findings, all 25
  receipts complete, 2,009 matched opens/closes and no guard failure.
- Final staged diff contains only the owned metadata feature. Original image/media
  edits remain unstaged in shared files; no README or QA fixture is staged.

Delivery is one cohesive local metadata feature commit on main. No push, release
or complete pipeline execution is part of this task. Full Presentation factory
integration remains an explicit public-model gap in the research receipt.
