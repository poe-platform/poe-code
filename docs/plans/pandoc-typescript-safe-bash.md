---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: TypeScript Pandoc-style conversion for safe-bash
readiness: draft
setup: false
teardown:
  prompt: |
    Finalize only the owned work for docs/plans/pandoc-typescript-safe-bash.md.
    Preserve unrelated changes. Report tested capabilities, pending tasks,
    upstream-coverage results and missing Office/README/visual gates accurately.
    Verify atomic local Conventional Commits include relevant plan updates.
    Do not run an inherited blanket commit, push, release or automatic scope cut.
    Local commits, verified remote main and successful publication are separate.
tasks:
  - id: freeze-conversion-contract
    title: "Freeze supported formats, options, losses and Office boundaries"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Create docs/pandoc/contract.md for the original TypeScript pandoc command and SDK.
      The required text profile reads commonmark, gfm, html, json, csv and tsv; writes
      commonmark, gfm, html5, json and plain. html is an output alias for html5.
      Do not alias markdown to commonmark: Pandoc Markdown is a different dialect.
      Required additional formats are latex, rst and rtf read/write; epub reads EPUB2/3
      and writes EPUB3; pdf is required output through a TypeScript layout/PDF engine.
      PDF reading/OCR is not included. EPUB2 writing is deferred. Keep markdown and
      commonmark_x deferred, along with formats not explicitly included here.
      All five additions are required delivery scope, not optional follow-up work.
      Define EPUB media/navigation/CSS limits, LaTeX macro/include limits, RST directive
      limits, RTF code-page/control-word support and PDF fonts/layout options. No TeX
      compiler, browser process, native PDF engine, arbitrary code or network fallback.
      Office adapters are a second capability gate: docx read/write, pptx read/write,
      xlsx read only, activated only with verified sibling SDKs. No XLSX writer here.
      Specify per-format defaults, extensions, loss policy, byte encodings, option
      precedence, metadata, multi-input semantics, deterministic output and error codes.
      Require explicit -f and -t unless --yes accepts documented inference/defaults;
      -o determines destination, not permission to silently select a writer. Missing
      format selection must give actionable usage in noninteractive safe-bash.
      Define a strict default for unsupported AST features, plus explicit --lossy
      warning-producing conversion. Plain output deliberately strips formatting;
      classify that intended projection separately from accidental content loss.
      Record all intentional differences from native Pandoc. Keep this contract about
      conversion, and do not change the independent DOCX/PPTX editor specifications.
      Accept only when every advertised format/flag has a concrete behavior or explicit
      rejection and each Office capability names a real dependency or a blocked gate.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: done
  - id: map-upstream-corpus
    title: "Build a pinned upstream-test and independent edge-case inventory"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Use the research clone /tmp/poe-pandoc-investigation-20260912 at Pandoc commit
      c9a9a5eed7185783b69043e019c067370dc09615. If absent, clone jgm/pandoc outside the
      worktree and check out that exact revision; do not replace it with moving HEAD.
      Read test/test-pandoc.hs, test/Tests/Readers/{Markdown,HTML,Docx,Pptx,Xlsx}.hs,
      test/Tests/Writers/{Markdown,HTML,Plain,AnnotatedTable,Docx,Powerpoint}.hs,
      test/Tests/{Command,Old,Shared,MediaBag,XML}.hs and relevant test/command files.
      Write docs/pandoc/upstream-cases.json with source commit/path/case locator,
      behavior, format/extensions, upstream issue ID when present, license provenance,
      original local test ID, status and reason. Inventory the whole relevant corpus,
      including external CommonMark coverage, not just a sample of easy cases.
      Statuses are planned, passing, failing, unsupported and not-applicable; only
      passing counts as evidence. A fixture-file count is never a passing-test count.
      Pandoc Haskell/tests carry GPL notices; keep the clone as research material and
      author fresh behavioral cases rather than copying implementation or fixture text.
      Record any deliberately imported standards fixtures and their actual licenses.
      Add missing-case rows for safety, chunking, Office structure and cancellation
      that upstream does not exercise. Acceptance requires every relevant discovered
      case assigned and each exclusion justified against docs/pandoc/contract.md.

      Required expanded-source inventory: test/Tests/Readers/{LaTeX,RST,RTF,EPUB}.hs,
      test/Tests/Writers/{LaTeX,RST}.hs, test/Tests/Old.hs, test/rtf, test/epub,
      writer.rtf, writer.latex, writer.rst and relevant test/command cases. Inspect
      src/Text/Pandoc/Writers/{RTF,EPUB}.hs and PDF.hs for behavior boundaries, without
      copying implementation. Native PDF is delegated to external engines; there is
      no upstream TypeScript layout test suite to port. Add independent font/layout/
      pagination/PDF-object cases and pin PDF/EPUB/RTF/RST primary specifications.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: done
  - id: resolve-package-boundaries
    title: "Resolve package ownership and existing parser reuse"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Inspect current packages/safe-bash/src/commands/{html-to-markdown,archive,xml,xan},
      contracts, exports and bundling declarations, plus docs/specs/{docx,pptx}.md,
      docs/plans/docx-typescript-safe-bash.md, docs/plans/pptx-typescript-safe-bash.md
      and any newly delivered XLSX SDK.
      Record a concrete dependency map in docs/pandoc/architecture.md. Proposed owner
      is private packages/pandoc for conversion logic, with a thin adapter under
      packages/safe-bash/src/commands/pandoc. Root only wires public APIs and bundles.
      Reuse bounded parsers/codecs only where their actual semantics fit. The current
      html-to-markdown Parser uses Node Buffer and is not proven to implement HTML5
      recovery; measure gaps before extracting anything. Keep the existing command's
      observable behavior. Do not import shell internals into the conversion engine.
      Office adapters consume sibling typed SDKs; ZIP/OPC/XML belong to their existing
      shared codec owner. The DOCX plan proposes packages/zip, not a delivered API.
      EPUB packaging shares the bounded ZIP codec but uses its own container/OPF/spine
      model, not OPC. PDF layout and serialization belong in private packages/pdf (or
      an existing verified equivalent); the converter supplies an AST-to-layout adapter.
      The PDF engine owns font metrics, line breaking, pagination and PDF objects.
      No speculative universal Office package, duplicate archive parser or second
      spreadsheet/presentation model. Prefer zero product dependencies; if a parser
      library is necessary, document its runtime portability, size, licensing and
      bounded-work strategy rather than pretending it is free or already approved by
      local package rules. No native Pandoc, subprocess, WASM Pandoc or network fallback.
      Acceptance is an acyclic package graph with exact existing and proposed symbols
      clearly distinguished, and explicit absent-dependency gates.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: create-engine-workspace
    title: "Create the conversion workspace and typed public API"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Create private packages/pandoc using maintained workspace conventions after
      checking docs/pandoc/{contract,architecture}.md. Add strict TypeScript ESM,
      .js import specifiers, build/typecheck/unit routes and explicit public exports.
      Expose typed readDocument, writeDocument and convert operations sharing one
      validation path; convert must perform real orchestration, not a redundant proxy.
      Use Uint8Array and explicit input/resource/output capabilities, AbortSignal,
      limits and typed diagnostics. No process.env, host filesystem, implicit fetch,
      current time or randomness in the engine. SDK limits cannot be raised by CLI.
      Use a discriminated text/binary result, document/resource ownership, and stable
      format capability descriptors. Keep public symbol names proposed until built.
      Add failing public-consumer tests, then implement the minimal useful conversion
      seam and exports. Do not fabricate a parser to make a smoke test pass.
      Every package requires its own README listing config and env exposure, but the
      repository requires explicit README permission: prepare exact proposed copy in
      docs/pandoc/package-readme-draft.md, record the publication gate, and do not edit
      README files without that permission. Do not claim package delivery complete
      while that gate is unresolved. Validate workspace declarations and build closure.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: document-ast
    title: "Implement the document AST, metadata and structural validation"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement a format-neutral document AST in packages/pandoc with typed metadata,
      blocks, inlines, attributes, links, images, code, lists, headings, quotes, line
      breaks, spans/divs, notes, figures and modern tables. Preserve distinctions such
      as Plain versus Para, SoftBreak versus LineBreak, and empty versus absent fields.
      Use validated runtime JSON data, not unchecked casts. Bound depth, nodes, text,
      attributes and table cells before allocation. Reject cyclic programmatic inputs,
      unknown tags, invalid union shapes, nonfinite values and invalid spans with paths.
      Keep source positions and loss diagnostics separate from serialized document data.
      Implement only normalization with a stated invariant; do not flatten nested
      formatting or delete semantically meaningful whitespace. Preserve ordered key/
      attribute semantics where required and protect dangerous object keys.
      Write original expected-AST tests first, including empty documents, Unicode,
      notes in lists, images in links and malformed table/metadata trees. Acceptance
      requires consumers to use exhaustive unions and failures to occur before output.

      The required LaTeX/RST/RTF/EPUB profile also needs definition lists, math source,
      notes, cross-reference identities, captions and document language/direction.
      Preserve math as typed source; targets unable to render it must fail strictly or
      use explicit diagnosed loss. Do not let the expanded readers emit undocumented
      AST shapes. Avoid introducing page geometry into the format-neutral AST; PDF
      layout is a separate model fed by document content and explicit style options.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: execution-budgets
    title: "Implement bounded decoding, cooperative work and resource ownership"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement the packages/pandoc execution context used by every reader/writer:
      strict incremental UTF-8, per-input BOM handling, documented CRLF/CR policy,
      owned retained bytes, bounded input/output, depth/nodes, table cells, resources,
      resource bytes, diagnostics and work units. Set and document finite defaults.
      Do not claim constant-memory conversion: a bounded AST is retained by design.
      Check budgets before growth, including reference indexes and decoded entities.
      Yield cooperatively during CPU parsing and writing so abort is observable.
      Await sink backpressure, stop acquiring after closure, and make cleanup idempotent.
      Unit-test max-1/max/max+1, one-byte input chunks, split multibyte UTF-8, invalid
      trailing bytes, producer buffer reuse, sink rejection and cancellation before,
      during and after work. Use original in-memory fixtures, no time-based sleeps.
      Acceptance requires identical document/output across chunk boundaries and no
      successful result after rejected output; state limits of uncooperative hosts.

      For EPUB add compressed/expanded bytes, part counts and XML/entity limits. RTF
      requires byte-aware decoding and binary-block limits rather than a blanket UTF-8
      predecode. LaTeX/RST require macro/include/directive budgets. PDF requires font,
      glyph, page, object, image and layout-work ceilings; deterministic progress must
      stop pagination loops. All share caller cancellation and aggregate resource caps.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: format-registry
    title: "Implement declarative reader and writer capabilities"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement a declarative format registry in packages/pandoc derived from format
      descriptors: names/aliases, read/write capability, text/binary media, extensions,
      default extension set and option capabilities. Dispatch readers/writers through
      lookups, not format-specific branches in the coordinator. Adding a new format
      must need one format module and maintained discovery/export wiring only, with
      no repeated lists for help, inference and validation. Follow actual workspace
      build conventions; do not introduce filesystem scanning in the product runtime.
      Parse format+extension-extension syntax with a scanner, validate names and
      unsupported combinations, and derive --list-input-formats, --list-output-formats
      and --list-extensions from registered capabilities. Explicit Office injection
      must not advertise an unavailable reader/writer. Test alias/collision handling,
      unknown names, duplicate toggles, disabled extensions and deterministic ordering.
      Core descriptors cover commonmark/gfm/html/json/csv/tsv/plain/latex/rst/rtf/epub/pdf as directional
      capabilities from docs/pandoc/contract.md; markdown is not an alias.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: json-interoperability
    title: "Implement validated Pandoc JSON import and export"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement packages/pandoc JSON reader/writer targeting the observed
      pandoc-api-version [1,23,1,2], with the contract documenting accepted versions.
      Consult pinned pandoc-types definitions and actual native JSON results; never
      assume a Haskell .native fixture is JSON. Modern Table and Figure structures,
      metadata variants, citations/math/raw nodes require explicit support or a typed
      unsupported-feature failure; do not drop them silently.
      Validate union arity, integer bounds, attrs, span geometry and nested values.
      Detect duplicate JSON object keys with a proper parser/tokenizer when the
      contract rejects them; JSON.parse alone cannot diagnose overwritten keys.
      Round-trip all supported AST variants against independent expected JSON,
      including empty metadata maps/lists and Unicode. Wrong API versions and unknown
      constructors must fail before writer output. Do not invent forward compatibility.
      Golden JSON normalization may ignore object key order only, never list order,
      node type, text, attributes or table shape. Canonical unit tests use original
      in-memory cases and no native executable.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: commonmark-block-reader
    title: "Implement CommonMark block parsing"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement the commonmark reader's block phase in packages/pandoc using a bounded
      scanner/parser, against CommonMark 0.31.2 and docs/pandoc/contract.md. Support
      paragraphs, ATX/setext headings, thematic breaks, block quotes, ordered/bullet
      lists, fenced/indented code, HTML blocks and link definitions. Do not parse
      nested syntax with regex substitutions. Preserve source line/column information.
      Write failing original cases for indentation/tabs, lazy continuation, tight and
      loose lists, list interruption, 1 versus other ordered-list starts, empty list
      items, nested containers, fence length/character conflicts, info strings,
      unclosed fences, trailing spaces, CRLF, EOF and thematic-break ambiguity.
      Bound open containers, buffered definitions and pathological long lines.
      Use an explicit temporary inline-token representation if needed, never fake
      final text nodes that make structural tests self-fulfilling. Validate expected
      block structure independently; keep incomplete reader capability unadvertised.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: commonmark-inline-reader
    title: "Implement CommonMark inline parsing and references"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Complete commonmark parsing in packages/pandoc with a bounded delimiter/bracket
      algorithm: emphasis/strong, code spans, escapes/entities, inline/reference links,
      images, autolinks, raw HTML, hard/soft breaks and text. Resolve references after
      block discovery, retaining documented duplicate-definition precedence.
      Write failing original cases for delimiter runs and rule-of-three interactions,
      intraword underscores, nested image/link combinations, forbidden nested links,
      backtick-run mismatch, normalized code-span spaces, balanced/escaped parentheses,
      titles, labels with whitespace/case/Unicode, empty targets, entity boundaries,
      angle autolinks, punctuation and unresolved references falling back to text.
      Map relevant upstream Markdown cases to CommonMark applicability rather than
      assuming Pandoc Markdown expected results apply to every dialect. Exercise
      CommonMark normative examples through a licensed separate conformance lane or
      original behavior tests with provenance. Acceptance requires the advertised
      commonmark profile's block and inline coverage, with no unexplained failures.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: gfm-reader-profile
    title: "Implement GFM extensions without conflating Markdown dialects"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Add the declared gfm reader profile to packages/pandoc on the CommonMark parser.
      Implement pipe tables, strikethrough, task lists, bare autolinks and disallowed
      raw HTML behavior with exact enabled/default extension definitions. Pin the GFM
      specification and compare actual Pandoc gfm flags before claiming equivalence.
      Test pipe escapes/code spans, empty/header-only tables, unequal rows, alignment,
      missing delimiters, multiline cells rejected or parsed as separate blocks,
      strikethrough delimiter runs, task markers inside nested/tight lists and Unicode
      URL punctuation/balanced brackets. Preserve task state in the documented AST.
      Do not implement footnotes, math, YAML metadata, smart punctuation or definition
      lists implicitly because Pandoc Markdown has them; reject unsupported extension
      requests. Add independent negative tests that syntax stays literal when disabled.
      Acceptance requires explicit differential classifications and deterministic
      extension toggling with the same descriptor used by help and SDK validation.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: html-reader
    title: "Implement structural HTML reading with explicit recovery semantics"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement html input in packages/pandoc using a real bounded HTML tokenizer/tree
      parser. Consult existing html-to-markdown parser only after evaluating its
      recovery/portability gaps; do not change that command's behavior as a shortcut.
      Convert headings, paragraphs, inline styles, lists, links/images, code/pre, div/
      span attributes, language/direction, figures and tables to AST. Define script,
      style, comments, raw content, base elements and unsupported-element policies.
      No DOM execution, CSS layout, entity-driven resource access or implicit fetching.
      Tests must cover quoted > in attrs, entities without semicolons where legal,
      numeric-invalid entities, whitespace around inline elements, NBSP, pre newlines,
      misnested formatting, omitted end tags, duplicate attrs, raw-text closing tags,
      void elements, malformed tables, captions and rowspan/colspan. Consult
      Tests.Readers.HTML and add cases for resource denial and invalid UTF-8.
      If the declared parser profile is narrower than HTML5, document exact recovery
      boundaries; do not advertise full browser parsing compatibility. Validate
      original expected AST independently of the Markdown writer.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: tabular-readers
    title: "Implement CSV and TSV as document tables"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement CSV/TSV readers in packages/pandoc, reusing the existing bounded xan
      CSV parser only after verifying semantics and extracting an actual shared need.
      Native Pandoc 3.10.1 probes show first-row headers, quoted CSV commas and literal
      TSV quotes; do not use identical quote rules for both formats by accident.
      Define empty files, empty cells, blank records, trailing delimiters/newlines,
      CRLF, multiline CSV quotes, escaped quotes, spaces and ragged rows. Reject
      malformed CSV with source location; cap fields, rows, columns and total cells.
      Treat contents as text, never evaluate spreadsheet formulas or coerce numbers.
      Map header and body rows into modern Table AST with deterministic column specs.
      Test BOM and multibyte chunk splits, significant leading zeroes, formula-looking
      text, one-column inputs and record termination. Keep XLSX parsing in its sibling
      engine; these readers do not create a spreadsheet model or an XLSX writer.
      Acceptance includes explicit exact/different outcomes for native CSV/TSV cases.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: table-semantics
    title: "Implement common table validation and target capability checks"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement table geometry validation and normalization in packages/pandoc for
      captions, colspecs, headers, multiple bodies, footers, row headers and spans.
      Use original cases inspired by Tests.Writers.AnnotatedTable and test/tables:
      zero/negative/oversized spans, overlapping occupancy, empty rows, spans crossing
      sections, uneven column counts and large sparse coordinates. No unbounded grid
      allocation. State which invalid tables fail instead of emulating upstream repair.
      Validate tables before writer output. HTML5 may retain supported spans; GFM can
      represent only its declared rectangular single-header subset. Under strict mode
      reject loss of spans/complex blocks; under explicit --lossy emit deterministic
      flattening diagnostics with node paths. Plain has a documented text projection.
      Test normalization idempotence and preservation of cell text/order with bounded
      generated tables. Do not test a writer only by reading its own output.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: html-writer
    title: "Implement HTML5 fragment and standalone writing"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement html5 writer and html alias in packages/pandoc for supported AST nodes.
      Separate escaping of text, attribute values and URLs; validate URI schemes and
      raw-content policy without fetching or executing resources. Declare the handling
      of retained dangerous markup explicitly; conversion alone is not sanitization.
      Write deterministic fragments and standalone HTML with escaped title, lang/dir
      and fixed original wrapper. No remote styles, syntax-highlighting engine or
      arbitrary template language in this profile. Support --standalone and metadata
      options consistently in SDK/CLI; reject unsupported template flags.
      Test nested formatting, code containing HTML, list starts/tightness, duplicate
      heading IDs, links/images/titles, figures, notes represented in JSON, multilingual
      text and table spans. Preserve content in empty and code-only documents.
      Compare DOM structure and separately assert escaping/output bytes for canonical
      cases; do not normalize away security attributes or meaningful whitespace.
      Use original expected outputs and map upstream Writers.HTML cases to coverage.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: markdown-writers
    title: "Implement CommonMark and GFM writers"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement commonmark/gfm writers in packages/pandoc with context-aware escaping,
      code-span delimiter choice, fence sizing, list indentation and link/reference
      serialization. Implement --wrap=none as the initial supported wrap mode; reject
      other values until separately specified and verified. Preserve hard/soft breaks
      according to contract, with deterministic LF and final-newline rules.
      Test text that resembles lists/headings/thematic breaks, leading/trailing spaces,
      backtick runs, fenced code containing fences, nested loose/tight lists, empty
      items, image alt content, parentheses/quotes in targets, reference collisions
      and adjacent nested emphasis. GFM supports declared task/table/strike syntax;
      commonmark rejects or explicitly projects incompatible features under --lossy.
      Use upstream Writers.Markdown and Tables as behavior inventory, plus independent
      expected strings and parse-back semantic checks. Round-trip checks supplement
      rather than replace independent oracles. Bound output amplification before
      escaping/indentation allocation. Do not claim native byte-for-byte parity for
      canonical formatting choices documented as intentional differences.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: plain-writer
    title: "Implement deterministic plain-text projection"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement plain output in packages/pandoc as an explicitly lossy text format.
      Specify paragraph/list/table separators, headings, code, notes, links, image alt
      text, captions and raw nodes; never concatenate adjacent words by deleting markup.
      Preserve Unicode and meaningful code whitespace with no ANSI styling or ambient
      terminal-width dependence. Support only the documented wrap policy.
      Write original expected-output cases inspired by Tests.Writers.Plain: empty
      nodes, nested lists, code indentation, CJK/RTL, emoji, combining marks, long URLs,
      links whose text differs from target, empty alt text and multi-paragraph cells.
      Formatting removal intrinsic to plain output is documented; dropping textual
      content or unsupported raw/math/citation meaning requires diagnostic or failure.
      Verify limits and CLI/SDK results agree for the same AST/options.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: conversion-coordinator
    title: "Implement metadata, multi-input conversion and loss preflight"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement real read -> AST -> validate/transform -> write orchestration in
      packages/pandoc. Typed convert options and CLI mapping must share validation,
      metadata merging, format descriptors and loss diagnostics. Metadata uses parsed
      objects and deep merge with explicit array/scalar/null precedence, never regex
      editing. No ambient defaults files or environment option injection.
      Define supported -M/--metadata and --metadata-file JSON inputs; reject YAML
      metadata files unless a proper bounded parser is deliberately added. Define
      ordered text operand joining, final-newline insertion and reference scope;
      reject multiple binary/JSON inputs unless an explicit merge contract is provided.
      Support --fail-if-warnings with preflight before output. Keep destination errors
      and cancellation distinct from parse errors. Test metadata collisions, repeated
      options, empty inputs, reader failure after earlier inputs, source locations and
      stable diagnostics. Reject filters, Lua, citeproc, arbitrary templates, external PDF engines and
      unknown flags before input/resource/output acquisition. Do not silently ignore
      options because the subset is smaller than native Pandoc.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: media-resolver
    title: "Implement explicit VFS media resolution and extraction"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement resource resolution in packages/pandoc through injected capabilities,
      with the safe-bash adapter supplying only its configured VFS. Preserve source
      base identity per input and distinguish resource keys, URLs and output paths.
      Support documented --resource-path and --extract-media behavior only; no HTTP,
      file URL, ambient home directory or host-font lookup. Raw links can remain text
      without acquiring their targets. Bound approved data URI decoding if supported.
      Use original cases inspired by Tests.MediaBag: escaped versus literal names,
      relative dot segments, Unicode names, hash/query suffixes, duplicate basenames,
      media collisions, repeated references and malicious traversal. Do not conflate
      lexical normalization with VFS symlink authority or decode percent escapes twice.
      Validate all extract destinations and collisions before writes where possible;
      state partial-write behavior where provider transactions are unavailable.
      Test denial without acquisition, resource byte limits, abort, producer reuse and
      missing image diagnostics under strict/--lossy modes. No implicit media download.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: latex-reader
    title: Implement bounded LaTeX document reading
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement latex input in packages/pandoc using a token/group/environment parser.
      Support document/section structure, paragraphs, emphasis, lists, quotes, verbatim,
      links, figures, tables, labels/references and typed inline/display math source.
      Define a bounded allowlist of simple user macro definitions and expansion rules;
      unsupported TeX primitives must fail or be explicitly preserved under loss policy.
      Never execute TeX, shell escape, arbitrary package code or catcode redefinitions.
      Any supported input/include resolves only through the injected resource capability
      with cycle/depth/byte limits. Missing includes fail before output.
      Use original tests inspired by Tests.Readers.LaTeX: escaped braces, comments and
      whitespace, nested groups, optional arguments, delimiter matching, math dollars,
      verbatim terminators, multicolumn tables, Unicode commands, macro recursion and
      undefined macros. Include malformed EOF, input cycles and forbidden primitives.
      Map strict versus preserved-raw versus --lossy outcomes to the coverage ledger;
      accept no silently deleted command arguments or invented full TeX compatibility.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: latex-writer
    title: Implement LaTeX writing and source-preserving math
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement latex output in packages/pandoc for the declared AST profile: sections,
      formatting, lists, definitions, notes, tables, images, links and math source.
      Use context-specific escaping and safe verbatim handling, deterministic labels,
      references and language options. Fragment and standalone output use an original
      fixed preamble with documented package requirements; no arbitrary template engine.
      Preserved math source may be serialized as math; unknown executable raw LaTeX is
      rejected under strict mode. No product compilation or shell escape.
      Original tests based on Writers.LaTeX cover special characters, code delimiters,
      nested notes, adjacent formatting, heading levels, long tables, table spans and
      image paths. Assert valid structure and explicit loss for unsupported nodes.
      Compile representative owned samples in an external QA lane with a pinned TeX
      oracle when available, with shell escape disabled and controlled resources.
      This oracle is not the PDF product backend; PDF uses the separate TS engine.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: rst-reader
    title: Implement reStructuredText reading and safe directive resolution
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement rst input in packages/pandoc with indentation/block and inline parsing.
      Cover heading adornments, paragraphs, bullet/enumerated/definition/field lists,
      block quotes, literal/line/code blocks, hyperlinks/targets, substitutions, notes,
      simple/grid tables, images and a documented directive/role allowlist.
      Include/raw directives cannot execute code or access ambient files. Any supported
      include uses explicit VFS resource capabilities and bounded cycle detection.
      Test original cases inspired by Readers.RST: conflicting adornments, indentation,
      blank-line significance, interpreted roles, substitution recursion, anonymous
      links, duplicate targets, numbered/symbol notes, literal block transitions and
      multiline table cells. Retain malformed-source location diagnostics.
      Pin docutils RST syntax as a reference, without invoking Python/docutils at runtime.
      Unknown directives/roles must produce explicit strict failures or preserved raw
      content and loss diagnostics; never appear to succeed by dropping their bodies.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: rst-writer
    title: Implement reStructuredText writing with stable structure
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement rst output in packages/pandoc with deterministic heading adornments,
      indentation, literal/code blocks, lists, definitions, references, notes and tables.
      Define supported image directives and role syntax. Generate collision-free
      reference names; keep displayed text separate from targets. Unsupported spans
      or inline nesting require strict failure or explicit diagnosed projection.
      Use original cases inspired by Writers.RST: nested styles, escaping at word
      boundaries, adjacent block types, code-leading punctuation, empty parents,
      heading widths with Unicode, deep heading levels, long table cells and list
      continuations. Validate expected text independently and parse it with a pinned
      docutils oracle in the explicit integration lane. No Python product dependency.
      Require every core AST family either a tested representation or a loss/error row.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: rtf-reader
    title: Implement byte-aware RTF tokenization and document reading
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement rtf input in packages/pandoc with a bounded group/control-word parser.
      Read bytes before code-page decoding; distinguish control symbols, signed numeric
      parameters, hex escapes, binary blocks, ignorable destinations and scoped state.
      Support the declared RTF 1.9.1 document subset: paragraphs/runs, styles/fonts,
      colors, lists, links, tables and supported picture encodings. Preserve Unicode
      u/uc fallback semantics including surrogate pairs and group-local settings.
      Test original cases inspired by Readers.RTF and test/rtf: nested state restoration,
      unknown destinations, braces in binary data, truncated bin counts, malformed hex,
      code-page switches, escaped slashes/braces, fallback skipping, table boundaries,
      list numbering, fields and picture limits. Embedded OLE/objects and active fields
      are never executed; strict unsupported cases fail without silently losing text.
      Pin the supported code pages explicitly and report unsupported ones; a UTF-8-only
      parser must not advertise general RTF reading. Never use regex substitutions.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: rtf-writer
    title: Implement interoperable RTF document writing
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement rtf output in packages/pandoc with deterministic font/color/style tables,
      proper group scope and control-word terminators, Unicode escape/fallback encoding,
      paragraphs, lists, links, supported tables and bounded PNG/JPEG picture encoding.
      Keep lengths and byte counts checked; reject unsupported embedded/active objects.
      Images and fonts come only from explicit resources. Define which font names are
      references versus embedded bytes; do not pretend the receiving app has a font.
      Use independently authored expected control structures and tests for braces,
      backslashes, non-BMP characters, bidi text, scoped formatting resets, cell/row
      terminators, nested lists, image expansion limits and invalid resource data.
      Consult native writer.rtf, command regressions and Writers/RTF.hs as behavioral
      research. Independently open generated RTF in an external application QA lane;
      round-tripping through the local reader alone is insufficient acceptance.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: epub-reader
    title: Implement EPUB2 and EPUB3 package reading
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement epub input in packages/pandoc using the shared bounded ZIP codec and
      an EPUB-specific model, not the Office OPC graph. Read mimetype, container.xml,
      OPF manifest/spine, EPUB2 NCX and EPUB3 navigation, metadata, XHTML and media.
      Preserve spine order, chapter identity, fragment targets, language and cover
      semantics while assembling the document AST. XHTML uses an appropriate namespace-
      aware parser; do not assume HTML recovery repairs malformed EPUB XML.
      Resolve only internal admitted resources with canonical part identity. Reject
      ZIP traversal, duplicate ambiguous entries, DTD/external entities, missing spine
      items, unsupported encryption/DRM and recursive dependency abuse. Never run
      scripts, fetch remote links, or silently turn fixed-layout books into faithful
      reflow. Diagnose unsupported CSS/layout/media-overlay losses explicitly.
      Original tests should cover upstream EPUB MediaBag/cover cases plus multiple
      rootfiles, percent-encoded links, nested paths, missing media, non-linear spine
      items, notes and cross-chapter links. Bound parts/expanded bytes and retain
      chapter provenance. Validate AST order and independent expected resource hashes.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: epub-writer
    title: Implement EPUB3 packaging, navigation and resources
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement EPUB3 output (epub and epub3 aliases) in packages/pandoc through the
      shared ZIP writer. Create valid mimetype placement/storage, container.xml, OPF,
      manifest/spine, navigation XHTML, chapter XHTML and declared resources. EPUB2
      writing remains explicitly unsupported. Target a recorded EPUB 3.3 profile.
      Define deterministic chapter splits and IDs, unique publication identifier,
      required title/language/modified metadata and explicit caller-supplied values or
      documented reproducible defaults; never consult ambient time/randomness.
      Generate original bounded CSS, TOC and cover support; rewrite cross-chapter
      fragment links using a complete target map. Unknown/missing targets fail or warn
      under documented policy. Never package remote active scripts or ambient files.
      Test Unicode filenames, duplicate headings, empty/long books, spine order, covers,
      media types, orphan resources and internal link closure using independent XML/ZIP
      assertions. Run pinned EPUBCheck and an independent reading application in QA,
      not unit/runtime. Check reflow, navigation and images, not just archive validity.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: pdf-engine-contract
    title: Define and establish the TypeScript PDF engine boundary
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Establish a real private packages/pdf engine (or inspect and reuse a delivered
      one) for PDF output, with public byte/capability API and a packages/pandoc adapter.
      PDF is a required output format; missing engine work must be implemented here,
      not left as an optional adapter or delegated to native TeX/Chromium/Pandoc.
      Pin the PDF reference revision and a concrete supported output profile, proposed
      PDF 1.7 with embedded supplied fonts and no encryption/JavaScript/attachments.
      Define a layout model separate from document AST: page boxes, text runs, blocks,
      images, tables, links and pagination constraints. Specify page size/margins,
      font selection/fallback and supported scripts; all fonts are supplied resources
      or deliberately licensed packaged assets, never ambient system discoveries.
      Evaluate bounded TypeScript font/shaping/PDF libraries against package rules;
      record exact dependencies and reject native/WASM compiler substitutes. If a
      library is used, own the layout semantics and budget integration rather than
      claiming its existence delivers PDF. Prepare required README copy under docs
      pending existing permission. Write failing public-API tests before engine code.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: pdf-layout
    title: Implement font-aware text layout and pagination
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement the required PDF layout engine in packages/pdf and AST adapter in
      packages/pandoc using explicit font resources and typed options. Support paragraphs,
      headings, lists, code, links, figures/images, notes and declared table structure.
      Use measured glyph advances, line breaking, font fallback, bidi/shaping for the
      advertised script profile and deterministic pagination. Missing glyphs or shaping
      capabilities must be reported, never silently substituted with empty squares.
      Define widow/orphan/keep rules, long-word handling, repeated table headers, row
      splitting and oversized-block overflow. Images retain aspect ratio and explicit
      fit rules. No pretend CSS/TeX layout equivalence. Unsupported math must fail
      strictly or use explicit readable source projection under --lossy.
      Test independent metrics and layout boxes for empty/one/multiple pages, long
      URLs/code lines, nested lists, multi-page tables, large images, notes near page
      boundaries and Unicode. Include zero-width/nonadvancing layout and font parsing
      attacks. Bound pages/glyphs/work before allocation and yield for cancellation.
      Accept only with rendered-page inspection of owned samples and no clipping,
      missing content or endless pagination; self-generated box assertions alone fail.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: pdf-writer
    title: Implement PDF object serialization and independent output validation
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.


      Implement bounded PDF serialization in packages/pdf: object identity, references,
      page tree, streams and lengths, xref/trailer, embedded supported fonts, Unicode
      mapping, images, link annotations, outlines and deterministic metadata. Produce
      Uint8Array output through the awaited sink; no host scratch files or subprocess.
      Use checked offsets and counts; reject resource exhaustion before allocation.
      Represent accessibility/tagging guarantees explicitly; do not claim PDF/A,
      PDF/UA, searchable text or correct extraction without the corresponding evidence.
      Create original minimal expected-object tests and malformed-resource regressions;
      verify text-to-glyph mappings, escaped strings, non-ASCII metadata, image color
      spaces and multiple-page references independently. Wire -t pdf and .pdf inference
      under --yes through the same SDK/options; reject --pdf-engine external commands.
      Run an independent PDF parser/checker and renderer in the explicit QA lane to
      inspect text, pages, links, fonts and visual layout. Pin oracle versions; different
      engines need not emit identical bytes. All supported reader-to-PDF pairs need
      representable-content tests; native Pandoc alone cannot validate this engine.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: safe-bash-command
    title: "Integrate the explicit pandoc command through the SDK"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement packages/safe-bash/src/commands/pandoc as a thin plugin over the
      packages/pandoc SDK, reading scoped AGENTS.md and honoring its delegation rules
      when executing this task. Provide matching create-command/family/plugin APIs
      only where the existing plugin contract requires them, with collision preflight
      and replace behavior. Register explicitly; do not silently add to agentCommands.
      Support -f/--from, -t/--to, -o/--output, --, ordered FILE/- operands, --yes,
      --standalone, --wrap=none, metadata, declared media flags, --lossy,
      --fail-if-warnings and capability/help/version commands from the frozen contract.
      No flags imply unsupported native capabilities. Use literal argv and retained
      byte validation, stdinIsDefault, VFS paths and Uint8Array streams.
      Enroll invocation cleanup before acquisition, use owned output operations,
      propagate signal/budgets and await writes. Reject input/output alias conflicts
      using actual filesystem identity when available, or safe refusal when unknown.
      Do not claim output atomicity on providers without it; shell > may truncate
      before invocation and must be documented separately from command -o behavior.
      Tests use actual Shell invocation with memfs-backed operations: pipes, redirection,
      quoted names, -- filenames, repeated -, broken pipes, abort and FS errors.
      Help/version/usage failures must not acquire input or truncate output.

      Include latex/rst/rtf/epub/pdf descriptors and binary PDF/EPUB stdout/-o behavior.
      Expose the frozen subset of PDF page-size/margin/font options and EPUB title/
      language/identifier/chapter options through the same typed SDK. Validate all
      font/style/resource requests before output; no ambient system fonts or external
      --pdf-engine. For RTF preserve raw bytes until its own encoding decoder runs.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: public-bundle-integration
    title: "Wire public exports and verify runtime portability"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Wire the pandoc SDK and explicit virtual-bash plugin through maintained package
      exports, build declarations and scripts/bundle-safe-bash.mjs as appropriate.
      Inspect current packaging routes before changing them; keep private virtual-bash
      identity and public root wiring rules. No internal dist-path imports in examples.
      Add failing public-consumer checks for SDK types, explicit plugin registration,
      collision behavior and packaged output. Verify target runtime imports contain no
      native Pandoc, child_process, implicit filesystem/fetch, dynamic native engine or
      accidental Office bundle when text-only capabilities are used.
      Run the exact maintained workspace build closure and package checks; because
      exports/bundling cross workspaces, run full npm test and repository lint at the
      integration gate. Do not substitute root-only test:unit or fixed task lists.
      If CI YAML changes, use npm run lint:workflows; do not add workflow unit tests.
      Do not modify existing agentCommands inventory unless that scope is explicitly
      chosen later, and do not rewrite sealed historical fixtures to make counts pass.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: docx-conversion-adapter
    title: "Add DOCX conversion through the independent DOCX SDK"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement DOCX read/write conversion in packages/pandoc only after checking that
      the sibling docx SDK from docs/specs/docx.md has verified public byte-based APIs.
      If absent, report the exact missing API and keep this task open; do not build a
      second DOCX parser/writer or weaken editor ownership. Text core remains usable.
      Map paragraphs/runs, headings, lists, hyperlinks, tables, notes and supported
      images into document AST and back through the sibling engine. Conversion creates
      a new document; it does not promise preservation of all original Office parts.
      Define reference-document subset and style mapping only for verified SDK support.
      Tracked changes, fields, math, floating drawings and unsupported document stories
      need explicit strict failure or --lossy diagnostics, never silent omission.
      Use original in-memory documents plus independent semantic/OPC inspection based
      on upstream Readers.Docx/Writers.Docx case families. Exercise relationships,
      styles/numbering, merged cells, missing media and Strict/Transitional input as
      supported by the sibling. ZIP limits/corruption tests belong at codec boundaries.
      Advertise docx only after public-consumer and independent Office-open evidence;
      keep preservation editing outside the conversion command.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: pptx-conversion-adapter
    title: "Add PPTX document conversion through the presentation SDK"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement pptx read/write adapters in packages/pandoc through verified public
      byte-based APIs of the separate presentation engine described in docs/specs/pptx.md.
      If those APIs are absent, record a blocked dependency and leave this task open;
      never implement PresentationML/ZIP again inside the converter.
      Define slide-heading level, title-only/blank slides, horizontal-rule breaks,
      paragraph/list content, supported images and tables, speaker-note policy and
      reference-deck layout mapping. Separate extraction order from visual reading order.
      Test ambiguous headings, content before first slide, nested lists, empty slides,
      notes, hyperlinks, aspect ratios, image sizing, missing layouts and overflow
      policy. No claim of measured text fit without a rendering engine.
      Use upstream Writers.Powerpoint layout/reference cases for breadth, not just the
      single basic reader fixture. Create original decks and assert slide order, text,
      relationships and media with an independent inspector and application-open QA.
      Reject unsupported animations/charts/embedded objects or explicitly diagnose
      loss. Native slide editing stays with pptx. Enable registry capability only when
      this dependency gate and conversion tests pass.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: xlsx-conversion-adapter
    title: "Add XLSX table extraction through the spreadsheet SDK"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Implement an xlsx reader in packages/pandoc only through the real sibling XLSX
      SDK; discover its actual package/API because none was found during planning.
      Missing public APIs are a blocked task, not permission to invent them or vendor
      a second workbook parser. No xlsx writer in this converter.
      Define sheet order/selection, hidden-sheet handling, used-range limits, first-row
      header policy, sheet captions and table construction. Distinguish cell displayed
      text, typed values and formula caches. Never recalculate formulas, execute macros,
      follow external workbook links or assume a formula cache is current.
      Test sparse/high-coordinate sheets, merged cells, shared/inline strings, rich
      text, booleans/errors, dates with 1900/1904 systems, leading zeroes, missing caches,
      multiple/empty/hidden sheets and Unicode. Use explicit SDK selection controls for
      any CLI sheet options rather than guessing native Pandoc flags.
      The upstream test/Tests/Readers/Xlsx.hs has only a basic sheet-extraction golden;
      author independent cases for all these missing families. Reuse sibling ZIP/OPC
      bounds and verify semantic tables with an independent workbook inspector.
      Advertise xlsx only once its gate passes; preserve all unsupported distinctions
      as errors or explicit loss diagnostics.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: differential-coverage
    title: "Close the compatibility ledger with independent evidence"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Execute the conformance matrix for packages/pandoc and its safe-bash adapter.
      Use docs/pandoc/upstream-cases.json and docs/pandoc/contract.md, with pinned
      source commit c9a9a5eed7185783b69043e019c067370dc09615 and separately identified
      native oracle version. The planning machine had Pandoc 3.10.1; do not claim it
      was built from the cloned HEAD. Record executable/version and supported flags.
      Native differential work is an explicit integration/oracle lane, never a product
      fallback or an uncached unit-test dependency. Use owned inputs and literal argv,
      no arbitrary execution of commands embedded in cloned upstream Markdown tests.
      Compare reader AST to independently validated native JSON, writers to structural
      and selected exact-byte expectations, and commands to stdout/stderr/status and
      VFS effects. Round trips alone do not prove correctness. Normalize only documented
      formatting differences, never content, list order, links, IDs, spans or warnings.
      Exercise all enabled reader/writer pairs with representable cases; verify typed
      failure for nonrepresentable features, capability denial and unknown options.
      For every mismatch reproduce a small failing unit test before fixing code.
      Reduce regressions to original memfs cases. Report actual pass/fail/unsupported/
      not-run denominators; close no row by skipping it or moving it out of scope.

      Mandatory matrix additions: latex/rst/rtf input and output, EPUB2/3 input and EPUB3
      output, and PDF output from every declared reader on representable content.
      EPUB requires independent container/OPF/XHTML/navigation validation. PDF requires
      independent parsing, text/page checks and rendered comparisons; native Pandoc is
      not a PDF parser and byte equality across layout engines is not meaningful.
      Pin any external rendering oracle separately; absent renderers remain not-run.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: adversarial-regressions
    title: "Verify bounded behavior and format-interaction regressions"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Stress the packages/pandoc SDK and actual safe-bash command with deterministic
      original adversarial cases: long delimiter/bracket runs, deeply nested lists/
      HTML/JSON, huge attributes, entity runs, dangling references, sparse tables,
      overlarge span arithmetic, escaping expansion, media aliases and decoder errors.
      Test random chunk boundaries and reused buffers, slow/rejecting sinks, stdout
      closure before first write, command cancellation and cleanup acquisition races.
      Use fake cooperative gates rather than sleeps; cap generators and fix seeds.
      Place small reproducible failures in canonical unit tests and heavier measurements
      in an explicit separate lane. Do not call a parser safe because a wall-clock
      Promise.race timed out while parsing continued; verify cooperative checkpoints.
      For enabled Office adapters include decompression/part/resource budgets through
      the sibling public API and exact no-write failure expectations where possible.
      Measure CPU work/allocation growth against documented budgets, not total process
      RSS guarantees. Acceptance requires no unexplained hangs, retained resources,
      unbounded fallback path or success after sink failure.

      Add LaTeX recursive definitions/include cycles, RST include/substitution cycles,
      RTF unbalanced groups/huge binary counts/code-page transitions, EPUB ZIP bombs/
      external entities/spine cycles, and PDF malformed fonts/oversized glyph indices/
      nonadvancing line and page breaks. Every new parser/renderer needs bounds before
      allocation and cooperative cancellation, not merely a post-hoc timeout.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: visual-qa-and-documentation
    title: "Execute visual QA and document the supported conversion profile"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Write and execute docs/plans/pandoc-typescript-safe-bash-qa.md as a Markdown
      agent procedure, not a QA script. Cover explicit plugin invocation, --help,
      invalid format/options, list capabilities, pipe and -o workflows and readable
      errors. Run npm run screenshot-poe-code -- <supported public invocation> for CLI
      changes using the actual integration path; do not invent a root pandoc subcommand.
      Inspect screenshots; do not create screenshot unit tests. Render generated
      standalone HTML for visual inspection and inspect representative DOCX/PPTX in
      an independent application only when those adapters are enabled. Verify headings,
      code, lists, merged tables, images and multilingual text; record missing renderer
      availability as not run, not successful visual QA. Do not execute active content.
      Update docs/pandoc usage/limitations and package README drafts with verified SDK
      and CLI examples, all limits/options, no env vars if none, format/extension matrix,
      loss behavior, source/oracle identity and explicit Office capability gates.
      README application/publication needs the existing explicit permission gate; do
      not change README files or claim that prerequisite is complete without it.
      Acceptance evidence must distinguish text conversion, Office conversion and Office
      editing and avoid unsupported full-Pandoc or full-fidelity claims.

      Required expanded QA: render PDF pages with an independent PDF renderer; inspect
      clipping, pagination, table continuation, links, image aspect ratios and Unicode.
      Open EPUB in an independent reader and verify spine/TOC/links/media/reflow. Open
      RTF in an independent word processor. Check LaTeX/RST outputs with pinned external
      tooling in the explicit QA lane only, never the product or unit test runtime.
      Record real visual findings and reduce defects to original small regressions.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
  - id: final-acceptance
    title: "Audit task completion and local delivery"
    prompt: |
      Implement only this task for the original TypeScript Pandoc-style converter.
      Read root and applicable scoped AGENTS.md; preserve unrelated changes. Use
      packages/pandoc for conversion logic and a thin safe-bash adapter; no native
      runtime fallback. For code changes write failing original tests first, implement,
      then run maintained checks for the scope. Unit mutations use memfs; no host
      scratch files, LLMs, downloaded fixtures or external executables in unit tests.
      Keep planning/QA procedures under docs/plans and evidence under docs/pandoc.

      Audit docs/plans/pandoc-typescript-safe-bash.md against docs/pandoc/contract.md,
      upstream-cases.json, actual public SDK/plugin behavior and maintained check results.
      The required text profile is commonmark/gfm/html/json/csv/tsv input and
      commonmark/gfm/html5/json/plain output, PLUS required latex/rst/rtf read/write,
      epub read EPUB2/3 and write EPUB3, and pdf output. All five additions must pass
      before final completion; initial text-only delivery is an intermediate milestone.
      Verify every advertised capability and
      option, strict/lossy errors, budgets, no-host-fallback behavior and independent
      edge-case evidence. Office tasks remain open if sibling APIs or QA are missing;
      do not mark the whole pipeline complete based only on the text milestone.
      Run full npm test, repository lint and npm run build for the final cross-workspace
      integration; use maintained declarations and uncached execution, preserving Git
      fixture environment isolation. Resolve observed failures rather than labeling
      them pre-existing. Validate the pipeline plan through poe-code pipeline validate.
      Report remaining README permission, dependency or renderer gates explicitly.
      Review atomic task commits and exact owned paths. Do not squash unrelated work,
      create empty commits, push or publish as part of this plan's local execution.
      If a later user instruction authorizes push, verify remote main separately from
      local commits and monitor GitHub publication to success; releases are never local.
      Archive only actual completed work and retain unresolved coverage/dependencies.

      Commit each verified atomic improvement on main with a Conventional Commit.
      Stage only files owned by this task explicitly, including relevant plan updates;
      never revert others' work, commit ignored files, add co-authors or use --no-verify.
      Do not create empty commits. Report local hashes; do not push or release unless
      a later user instruction authorizes it. Keep incomplete work/status honest.
    status: open
---

# TypeScript Pandoc-style conversion for safe-bash

## Scope and execution decisions

This is an implementation plan, not an implementation or a claim of compatibility.
The request permits fewer formats, asks for the same architecture as the adjacent
Office work, and explicitly requests stepless tasks with commits in their prompts.
The local/user pipeline configuration has implement/refactor/test/commit/release
steps and an automatic commit teardown. This file deliberately uses scalar
`status: open`, disables setup, and overrides teardown. Every task contains its
own testing and atomic local commit requirements. Writing this plan does not run
those tasks, commit existing work, push main or start a release.

The first milestone is a useful bounded text converter. The required expanded
scope also includes LaTeX, RST and RTF read/write, EPUB2/3 reading and EPUB3
writing, and PDF output. Those additions are required before pipeline completion. Office integration tasks
are retained as concrete work, not counted as delivered by an empty adapter.
They depend on independently delivered public SDKs. A missing sibling API does
not block developing the text converter but does block that Office task and full
pipeline completion. Tasks are listed in dependency order; core verification can
proceed while Office dependencies remain unavailable.

The conversion utility is exposed as `pandoc` inside an explicitly registered
safe-bash plugin. It has its own version/profile identity and must not report
native Pandoc's version as its own. The TypeScript library is independently usable.
No new root CLI command or standalone npm executable is assumed by this plan.

## Investigation performed on 2026-09-12

### Source checkout and oracle identity

Cloned `https://github.com/jgm/pandoc.git` with `git clone --depth 1` to
`/tmp/poe-pandoc-investigation-20260912`, outside the repository. The inspected
revision is `c9a9a5eed7185783b69043e019c067370dc09615`, dated 2026-09-12, with subject
“Docx writer: include default style even if paragraph has non-style props.”
The clone was retained for the implementation investigator; it is disposable and
not a runtime or unit-test dependency. Reproduction must fetch/check out the pin,
not silently use a newer shallow HEAD.

The installed oracle is `/opt/homebrew/bin/pandoc`, version **3.10.1**,
with `+server +lua`. This binary was not built from the cloned revision.
Six original stdin conversions were run with literal argv and
`--sandbox --from FORMAT --to FORMAT --wrap=none`. All six exited 0 with empty
stderr. These are native behavior probes, not tests of the proposed converter:

| Probe                                        | Observed result                                       | Implication                                                                   |
| -------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------------------- |
| CommonMark heading and bold paragraph → JSON | Header/Para/Strong nodes, API version `[1,23,1,2]`    | Pin JSON version and preserve structural variants                             |
| GFM two-column pipe table → HTML5            | Separate table head/body and two cells per row        | Table parsing/writing needs structural assertions                             |
| Pandoc Markdown footnote → HTML5             | Numbered note, reference and backlink markup          | Markdown is not a CommonMark alias; notes can still enter through JSON/Office |
| CSV with quoted comma → JSON                 | First record becomes header; comma stays in cell text | CSV semantics need their own parser cases                                     |
| TSV with quoted word → JSON                  | Quotes remain literal cell content                    | Do not inherit CSV quote semantics for TSV                                    |
| HTML table with `colspan=2` → JSON           | Modern Table node with a two-column cell span         | A flat rows-of-strings model is insufficient                                  |

No native build, broad corpus execution, product performance test or application
rendering was performed during this planning task. No existing implementation bug
is claimed from these probes.

### Upstream structure actually inspected

The source separates format readers, a shared document representation and format
writers. `src/Text/Pandoc/Readers.hs` distinguishes text and binary readers;
`Writers.hs` registers writers separately. The document type is supplied by
`pandoc-types`, with the inspected cabal constraint `>=1.23.1.2 && <1.24`.
CommonMark parsing depends on commonmark/commonmark-extensions/commonmark-pandoc
libraries; porting only the handwritten Pandoc Markdown reader would miss that
separate dialect implementation. App-level behavior belongs outside readers.

Reference links use the frozen source revision:

- [Reader registry](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/src/Text/Pandoc/Readers.hs)
  and [writer registry](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/src/Text/Pandoc/Writers.hs).
- [Top-level test composition](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/test-pandoc.hs),
  [command case harness](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/Command.hs),
  and [legacy golden harness](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/Old.hs).
- [Markdown reader cases](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/Readers/Markdown.hs),
  [HTML reader cases](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/Readers/HTML.hs),
  [table properties](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/Writers/AnnotatedTable.hs).
- [Media path cases](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/MediaBag.hs),
  [presentation writer cases](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/Writers/Powerpoint.hs),
  and [XLSX reader cases](https://github.com/jgm/pandoc/blob/c9a9a5eed7185783b69043e019c067370dc09615/test/Tests/Readers/Xlsx.hs).
- [Pandoc type project](https://github.com/jgm/pandoc-types),
  [CommonMark 0.31.2](https://spec.commonmark.org/0.31.2/), and
  [GFM specification](https://github.github.com/gfm/) are additional references;
  their exact imported revisions and fixture licensing must be recorded before use.

The file census below came from recursive regular-file enumeration, not inferred
from test names. It includes inputs, expected outputs and helpers, and is not a
case count or coverage percentage.

| Upstream directory | Files at inspected revision |
| ------------------ | --------------------------: |
| `test/Tests`       |                          64 |
| `test/command`     |                       1,201 |
| `test/tables`      |                          24 |
| `test/docx`        |                         236 |
| `test/pptx`        |                         153 |
| `test/pptx-reader` |                           2 |
| `test/xlsx-reader` |                           2 |

The inspected XLSX and PPTX reader Haskell modules each declare one basic golden
case. Their two-file directories pair input with expected output. The PowerPoint
writer suite is much richer: layouts, slide-level rules and reference documents.
This imbalance makes a copied upstream-reader corpus inadequate for Office edge
coverage. The ledger task must examine relevant issue-command tests as well.

The Haskell source/test headers identify GPL version 2 or later; root poe-code
package metadata identifies MIT. This plan uses the upstream implementation and
case taxonomy as research, with original test inputs/assertions and independent
TypeScript implementation. It does not silently vendor their source, binary Office
fixtures, reference templates or golden strings. Any later decision to import
material must retain its actual license/provenance; no claim of automatic license
compatibility is made.

### Existing project architecture and gaps

Inspected local paths, without modifying the adjacent work:

| Path                                               | Finding and planning consequence                                                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/safe-bash/package.json`                  | Private workspace name is `virtual-bash`; use its maintained build/test/typecheck routes                                                |
| `packages/safe-bash/AGENTS.md`                     | Byte streams, explicit capabilities, no product native process or ambient host access, scoped delegation rules                          |
| `packages/safe-bash/src/contracts/command.ts`      | CommandContext carries byte argv, streams, VFS, signal, input budget and cleanup enrollment                                             |
| `packages/safe-bash/src/commands/index.ts`         | Plugin registration has collision preflight and replacement policy                                                                      |
| `packages/safe-bash/src/commands/html-to-markdown` | Existing bounded HTML parser/renderer and established stdout cleanup behavior; not proof of full HTML5 recovery or generic document AST |
| `packages/safe-bash/src/commands/archive`          | ZIP read/write machinery already exists; reuse through a verified codec boundary when needed                                            |
| `packages/safe-bash/src/commands/xml`              | Existing XML command machinery; do not conflate query implementation with a reusable namespace-preserving Office codec                  |
| `packages/safe-bash/src/commands/xan/csv.ts`       | CSV implementation to assess for bounded reuse and semantic differences                                                                 |
| `scripts/bundle-safe-bash.mjs`                     | Maintained product bundle integration point                                                                                             |
| `docs/plans/docx-typescript-safe-bash.md`          | Proposed independent DOCX engine, thin command adapter and extraction of shared ZIP codec into `packages/zip`                           |
| `docs/specs/docx.md`, `docs/specs/pptx.md`         | Adjacent proposed Office contracts; source of ownership boundaries, not evidence of delivered APIs                                      |

The PPTX plan at `docs/plans/pptx-typescript-safe-bash.md` arrived during this
investigation and was inspected before finalization. It independently proposes
`packages/pptx`, a thin `packages/safe-bash/src/commands/pptx` adapter and justified
shared ZIP/OPC/XML boundaries. This reinforces the dependency direction above.

No XLSX/PPTX/DOCX implementation package or XLSX plan was found in the inspected
workspace inventory. XLSX may be progressing elsewhere as the user indicated.
Treat newly arriving SDKs as dependencies to inspect, not APIs to invent. Existing
untracked `docs/docx`, the DOCX plan and `docs/specs` are unrelated work and remain
untouched. This plan borrows architectural direction without changing their scope.

## Proposed format and compatibility matrix

| Format name                | Read                              | Write           | Boundary                                                              |
| -------------------------- | --------------------------------- | --------------- | --------------------------------------------------------------------- |
| `commonmark`               | Core                              | Core            | CommonMark 0.31.2 profile, no silently enabled Pandoc extensions      |
| `gfm`                      | Core                              | Core            | Declared tables/strike/tasks/autolinks/raw-tag policy                 |
| `html`                     | Core                              | Alias           | Structural HTML input; output alias of `html5`                        |
| `html5`                    | No separate reader alias required | Core            | Fragment and fixed standalone wrapper                                 |
| `json`                     | Core                              | Core            | Validated Pandoc JSON `[1,23,1,2]` subset, unsupported nodes explicit |
| `csv` / `tsv`              | Core                              | No              | Document tables; distinct quoting rules, no spreadsheet evaluation    |
| `plain`                    | No                                | Core            | Document text projection, not an invented Pandoc plain reader         |
| `docx`                     | Dependency gate                   | Dependency gate | Independent DOCX engine; conversion is not preservation editing       |
| `pptx`                     | Dependency gate                   | Dependency gate | Independent presentation engine; declared layout subset               |
| `xlsx`                     | Dependency gate                   | No              | Independent spreadsheet engine; tables from sheets                    |
| `markdown`, `commonmark_x` | Deferred                          | Deferred        | Do not mislabel the supported CommonMark/GFM implementation           |
| `latex`                    | Required                          | Required        | Bounded document syntax; no TeX execution                             |
| `rst`                      | Required                          | Required        | Documented directive/role subset; no code execution                   |
| `rtf`                      | Required                          | Required        | Byte-aware control groups, Unicode, tables and images                 |
| `epub`                     | EPUB2 and EPUB3                   | EPUB3           | Shared ZIP codec; dedicated container/OPF/spine/navigation model      |
| `pdf`                      | No                                | Required        | TypeScript font/layout/PDF engine; no native renderer                 |
| Other unlisted formats     | Deferred                          | Deferred        | No hidden native fallback                                             |

The small format set does not excuse superficial coverage inside advertised
formats. Every supported feature must be covered at parser, AST, writer and shell
boundaries; nonrepresentable conversion pairs must fail or require explicit loss.
Full native CLI equivalence, all Pandoc extensions, layout preservation, formula
recalculation and citation processing are outside this plan. A bounded TypeScript
PDF layout/writing engine is now required; general browser/TeX rendering, PDF
reading/OCR and arbitrary layout fidelity remain outside the declared profile.

## Architecture and interface proposal

```text
literal safe-bash argv + byte streams + explicit VFS
    -> command option validation / capability binding
    -> packages/pandoc typed convert API
        -> declarative reader lookup
        -> bounded document AST + metadata + resource references
        -> structural validation / loss preflight / transforms
        -> declarative writer lookup
        -> awaited output sink

Office format adapters -> sibling DOCX / PPTX / XLSX SDKs
                      -> their shared ZIP / OPC / XML implementation
```

The engine owns document conversion, descriptors, validation and diagnostics.
EPUB owns a publication/spine model over the shared ZIP codec. PDF owns a separate
layout/font/serialization engine; it is not an Office adapter or a LaTeX compiler.
The adapter owns shell argument parsing, VFS mapping and command lifecycle.
The shell owns pipelines, redirection and exit propagation. The root package
owns export/bundle wiring only. Office engines own format-specific semantics.
No callback should exist solely to proxy another function without adding a real
boundary or behavior. Formats should add one descriptor/module, not branches
through the coordinator and repeated independent format lists.

Proposed public operations are `readDocument`, `writeDocument`, and `convert`.
Exact exported signatures are finalized in the contract task; these names are not
presently usable APIs. Options include reader/writer identity and extensions,
explicit metadata, loss policy, standalone/wrap controls, signal and resource
capabilities. Host ceilings constrain input/output/work/depth/nodes/media.
Results distinguish text versus binary bytes and ordered typed diagnostics.
Cancellation remains distinguishable from ordinary parse/usage failures.

Use bounded whole-document AST construction deliberately. Incremental input and
output reduce copies but do not make reference resolution and document conversion
constant-memory. References, metadata and resources require independent budgets.
Supported native defaults must not override the repository's `--yes` rule:
explicit format flags work without prompts; missing selections produce actionable
usage unless `--yes` accepts the documented default/inference profile. No spinner
or human-facing progress may corrupt conversion stdout. CLI screenshots belong
to the actual public invocation path, not a made-up root command.

## Coverage and acceptance method

Coverage is a traceability problem, not a promise that all imaginable edge cases
can be enumerated. Every applicable upstream case receives a disposition and a
local test mapping. Original generated and hostile cases cover gaps. Each
advertised behavior needs independently meaningful expected results.

| Layer        | Required evidence                                                      | Insufficient substitute                            |
| ------------ | ---------------------------------------------------------------------- | -------------------------------------------------- |
| Reader       | Original input → independently asserted AST; pinned oracle comparisons | Same implementation's parse/write round trip alone |
| AST/JSON     | Constructor/shape validation, malformed input and version tests        | TypeScript compile-time type assertions alone      |
| Writer       | Expected text/structure, escaping and loss behavior                    | Merely opening generated bytes                     |
| Tables       | Geometry and content-order assertions, bounded property cases          | Comparing only row counts                          |
| Resources    | Exact resolution/denial, bytes, collisions and cleanup                 | Removing unsafe-looking substrings                 |
| Shell        | Actual Shell stdin/pipes/VFS/status/cleanup behavior                   | Calling a handler with a permissive stub           |
| Office       | Independent structure checks and application-open/render QA            | ZIP integrity or converter reading its own output  |
| Distribution | Maintained build plus public-consumer imports/registration             | Internal source imports passing unit tests         |

For exact parity rows, compare stdout/stderr/status and effects. For semantic
parity rows, define permitted normalization before running comparisons. For
intentional differences, document input, native behavior, local behavior and the
reason. Unsupported, unavailable and not-run rows never count as passing.
Native oracle commands are literal and controlled; the upstream Markdown command
harness is studied, not executed as arbitrary shell input in this repository.

All code tasks use TDD and small deterministic in-memory regressions. Canonical
unit runs do not write scratch files, query LLMs, clone sources, invoke native
Pandoc or depend on downloaded Office fixtures. Unit filesystem mutations use
memfs. Oracle/visual/integration captures are separate explicit work and use owned
outputs. QA is a Markdown procedure under `docs/plans`, not an executable script.

Focused tasks use maintained workspace checks. `virtual-bash` currently declares
`test`, `test:unit`, `typecheck`, `typecheck:consumers` and `build`; the new conversion
workspace must declare its own checks rather than guessing an undeclared command.
Selected workspace builds use
`npm run build:workspaces -- --workspace=<exact-name>`. Shared extraction, public
exports and bundle integration require the broader `npm test`, repository lint
and normal `npm run build` gates. Preserve the maintained test runner's uncached
dependency closure, native npm lifecycle and fixture Git-environment isolation.
Do not replace these with root-only `npm run test:unit`, hand-counted workspaces
or a bespoke QA script. Workflow changes use `npm run lint:workflows` only for
workflow-specific validation.

## Delivery gates and unresolved facts

- Text milestone: all declared text formats, supported options, SDK/plugin parity,
  limits, diagnostics, coverage ledger and public-consumer evidence pass.
- Expanded-format milestone: LaTeX/RST/RTF read/write, EPUB2/3 reading and EPUB3
  writing, and PDF output all pass their format-specific conformance, resource
  bounds, public API and independent application/render QA gates. An unavailable
  PDF engine is unfinished required work, not permission to remove PDF.
- Office milestone: each adapter's real sibling APIs, structural coverage and
  independent visual/open checks pass. Absent APIs remain recorded blockers.
- Documentation gate: each package needs a README with options/env exposure;
  repository policy also requires explicit permission for README additions.
  Exact drafts can be prepared now; this plan does not manufacture permission.
- Final integration: broad maintained checks, plan validation and reviewed visual
  evidence; no unsupported claim of full Pandoc or Office conformance.
- Git delivery: each task commits atomic owned improvements on main, including
  relevant plan changes. No blanket staging, ignored fixtures or co-author line.
  This plan requests local task commits; no push/release is authorized here.
  A future authorized push must be reported separately, verified on remote main,
  and monitored until successful GitHub publication.

The biggest implementation risks are Markdown delimiter/reference complexity,
HTML recovery mismatches, AST feature loss, table span semantics, media authority,
CPU work that fails to yield, and absent Office SDK contracts. The task ordering
puts their contracts and reproducible tests before integration claims. Adding
more formats should wait until this bounded profile has honest, complete evidence.

## Required format expansion

The user explicitly added PDF, EPUB, LaTeX, RST and RTF after reviewing the initial
format list. They are required scope, replacing the initial deferral. PDF is
planned as output, consistent with Pandoc's conversion direction; PDF extraction
and OCR are not implied. EPUB reads versions 2 and 3 and writes version 3.
LaTeX, RST and RTF are bidirectional. All retain strict/lossy conversion policies
and CLI/SDK parity. The plan now contains 39 stepless tasks.

The pinned Pandoc checkout has readers and writers for LaTeX, RST, RTF and EPUB.
Additional inspection found LaTeX cases for groups, math, comments, tables, macro
conditionals and language spans; RST cases for field lists, roles, notes and block
transitions; EPUB cases for media/cover variants. RTF and EPUB writer coverage
also requires the legacy golden and command suites rather than assuming a
dedicated Writers test module exists for every format. These are taxonomy
findings, not successful runs of those suites.

[Native Pandoc's PDF route](https://pandoc.org/MANUAL.html#creating-a-pdf) invokes
an external engine. A TypeScript PDF writer therefore needs independent layout,
font, pagination and serialization work beyond porting Pandoc tests. No existing
PDF implementation package was located in this investigation. Required PDF
work is explicitly scheduled, not assumed to exist.

[EPUB 3.3](https://www.w3.org/TR/epub-33/) supplies publication/container/content
requirements. The implementation must pin relevant schemas and use independent
EPUB validation and reader QA. EPUB ZIP containers are not Office OPC packages.

The expanded validation ledger must include all five formats in reader/writer
pair tests, capability reports, unsupported-feature diagnostics, distribution
checks and resource limits. Byte-identical PDF output to a different layout
engine is not a meaningful acceptance criterion; independently inspected page
content, geometry, font mappings and rendered appearance are. New format work
keeps the same per-task TDD and atomic local commit requirements.


## Final acceptance audit, 2026-09-16

The pipeline remains draft with finalization pending. Availability of the text
and expanded-format implementations does not close the required profiles or QA.
The audit reopens only tasks with concrete unresolved acceptance prerequisites:
upstream completeness review, workspace README delivery, DOCX/XLSX dependencies,
PPTX application QA, LaTeX/RST/EPUB reader profile reconciliation, RST loss
behavior, PDF layout/serialization requirements, text-only Office-bundle isolation,
whole-contract conformance and visual/documentation gates.
The final-acceptance task remains open; no unresolved work is archived.

Procedure: [final acceptance audit](pandoc-final-acceptance.md). Findings and
maintained check outcomes: [audit evidence](../pandoc/final-acceptance-audit.md).
Existing pending task-status edits and public-wiring captures are separate work;
only the audit's own plan annotation belongs to its local commit. No push,
remote-main verification or publication is performed.

The fresh full maintained test rerun exits 1: shared tests pass, but 37 native
Bash archive/cleanup controls fail at unstaged Pandoc SDK metadata admission.
Later workspace stages and npm posttest are not reached. Build, repository lint
and final pipeline validation pass separately; integration acceptance stays open.
The executed audit retains this dependency repair and strict PDF attribute/font
subsetting and plain-note projection evidence; it does not finalize the pipeline.
