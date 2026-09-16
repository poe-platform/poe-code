# Pinned Pandoc corpus inventory

This is the `map-upstream-corpus` task only. Conversion code and the safe-bash
adapter belong to subsequent tasks. The research checkout is detached at
`c9a9a5eed7185783b69043e019c067370dc09615` outside the worktree.

[upstream-cases.json](upstream-cases.json) assigns reserved original test IDs to
4,211 rows: 4,198 planned and 13 not-applicable. There are **zero passing tests**.
These IDs identify future original cases, not existing test functions. Native
expectations are research targets; locally admitted semantics, typed rejection,
and strict/lossy behavior are governed by [contract.md](contract.md).

The inventory includes every requested reader/writer module, Old, Command,
Shared, MediaBag and XML, plus the ImageSize and OOXML/helper dependencies found
through suite wiring. `suiteRouting` explains exclusion of unlisted format suites.
The separate 2,038-entry artifact census covers the complete pinned tracked
`test` tree, including nonselected formats and input/output resources. Artifact
counts, fixture-behavior rows and whole-document goldens are never passing-test
counts. Golden files still require fresh content-level decomposition during
implementation; no binary/text golden fixture was imported.

Command discovery is nonrecursive: 1,105 top-level Markdown files contain 1,848
fenced command cases. Two nested Markdown documents are input resources and have
separate planned assignments. Opening fence lengths matter because some input
contains shorter fences. Percent signs in TeX expected output are not commands.
The upstream runner executes shell strings; original unit cases must instead use
the public TypeScript SDK/adapter with memory capabilities and memfs.

Generated registrations include 41 bare-link variants, ten list-marker/code
variants, eight mixed-list/newline variants and eight mixed-list/blank-line
variants. PowerPoint registers 45 regular cases twice (default and reference
formatting), plus eight reference-specific cases. Custom reference documents
remain rejected by the contract; their planned cases assert rejection rather
than promising the upstream layout. Old writer helpers expand basic/tables,
extended tables and literate profiles independently of fixture-file discovery.

External coverage assigns every one of the 652 CommonMark 0.31.2 specification
examples and 672 examples in `cmark-gfm`'s `0.29.0.gfm.13` specification source.
GFM's older CommonMark baseline does not override the contract's 0.31.2 core.
Pandoc declares ranges for its CommonMark dependencies, rather than pinning their
separate test repositories; this inventory does not claim those repositories'
regression/fuzz suites were enumerated. Specification example payloads remain
research-only, licensed CC-BY-SA-4.0; the parser's BSD/MIT notices do not license
the specification as BSD/MIT. No standards fixtures were deliberately imported.

Pandoc test/source module notices specify GPL-2.0-or-later. This change contains
locators, case names, hashes and original behavioral descriptions, not copied
implementation or fixture bodies. Binary fixtures may have separate embedded
provenance; the repository GPL notice does not establish permission to import
third-party media, documents or fonts. Original Office/EPUB/RTF fixtures must be
constructed in memory from independently authored content.

## Expanded writer boundaries

RTF writing researches Unicode escaping, list tables/overrides, heading outline
levels, rectangular table projection and PNG/JPEG pictures. Native writing can
fetch resources, emit raw RTF, omit non-RTF raw content, and use configurable
preambles/templates. Original writing must enforce the contract's resource/loss
policies, complete deterministic wrapper and 12pt default instead.

EPUB writing researches container/OPF/manifest/spine, chapters, NCX/nav, cover
references and media packaging. Native writing supports EPUB2, custom CSS/fonts,
resource fetching, templates, current modified timestamps and platform-oriented
metadata. The original writer admits EPUB3 only, a fixed local stylesheet,
explicit images, fixed modified time, stable packaging and bounded semantics.
The reader's media-bag cases include GIF: they are planned profile/loss cases,
not evidence that GIF is supported by the original packaging profile.

`src/Text/Pandoc/PDF.hs` orchestrates external TeX, HTML, Typst and roff engines,
including temporary files and image conversion. It supplies no TypeScript font,
layout, pagination or PDF-object test suite to port. The 69 independent missing
cases include font licensing/metrics/subsetting, searchable Unicode, clipping,
page geometry and wrapping, row pagination, page budgets, object references,
xref offsets, stream lengths, annotations and deterministic bytes. These are
original obligations; none has been executed or passed.

[primary-specifications.json](primary-specifications.json) pins published PDF,
EPUB, RTF and RST versions. PDF 1.7, EPUB3.3 and versioned Docutils markup/role/
directive documents have retrieval hashes. RTF 1.9.1 primary URLs returned 404,
and legacy EPUB2 URLs returned 403; their primary bytes remain unverified.

## Acceptance status

The metadata assignment is a broad initial inventory, not whole-corpus runtime
acceptance. Completeness requires a second declaration/discovery review,
particularly generated helper registrations and command parsing; that review is
still pending. RTF and EPUB2 primary-document retrieval remains incomplete.
The plan task stays open. Only implemented original tests with maintained run
evidence may transition rows to passing. Planned rejections must identify the
specific contract behavior in the eventual test; native-only expectations must
not be converted to passes merely by skipping them.
