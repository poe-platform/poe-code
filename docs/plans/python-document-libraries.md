---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
name: Python document libraries and complete document skill workflows
readiness: draft
setup:
  prompt: |
    Read applicable AGENTS.md. Execute docs/plans/python-document-libraries.md as a
    follow-on to docs/plans/pyodide-safe-bash.md, which the user explicitly considers
    complete. Do not restart that foundation or rewrite its historical evidence.
    Preserve unrelated working-tree changes and existing TypeScript office projects.
    Work on main. This plan does not authorize pushing or publishing. Tasks execute
    in listed order, with failed prerequisite capabilities kept visibly open.
    All planning and manual QA plans belong in docs/plans. Durable library evidence
    belongs in docs/python-documents. Use TDD for code changes, fast in-memory unit
    tests, and separate opt-in real-runtime integration coverage. Follow scoped
    delegation requirements when editing safe-bash. Do not edit README without
    permission. Never copy proprietary skill implementation into the product.
    The user requires ordinary Python libraries, including the difficult dependencies,
    not only equivalent file formats. Package installation, import, operation,
    preservation, rendering and native-application behavior are distinct claims.
    Never remove a required library, skip its dependencies, substitute another API,
    or mark a wrapper supported because its native executable is absent gracefully.
    Keep the canonical safe-fs filesystem authoritative. No host Python fallback,
    implicit native subprocesses, whole-workspace mirroring or network service uploads.
teardown:
  prompt: |
    Update docs/plans/python-document-libraries.md and docs/python-documents evidence
    with exact completed capabilities, unresolved libraries and required workflows.
    Reconcile the complete dependency and workflow registers, including extras and
    native binaries. Missing mandatory evidence leaves the relevant task open.
    Report checks actually executed, runtime/deployment versions, rendered evidence
    and any remaining fidelity or packaging limits. Do not commit unrelated work,
    edit README, push or publish as an automatic teardown side effect. Report any
    explicitly requested local commits, verified remote-main delivery and successful
    releases separately; none can be inferred from another.
tasks:
  - id: lock-library-and-workflow-inventory
    title: Turn the researched inventory into a complete dependency and workflow register
    prompt: |
      Treat docs/plans/pyodide-safe-bash.md as complete. Read applicable AGENTS.md.
      Create durable
      source, dependency and workflow registers in docs/python-documents using the
      researched Anthropic revision 34040c9c568585f6929bedeaad110ad08f079624 and installed
      Codex plugin revision 26.909.12148. Fetch Anthropic xlsx/docx/pptx/pdf SKILL.md
      and referenced helpers from
      https://github.com/anthropics/skills/tree/34040c9c568585f6929bedeaad110ad08f079624/skills.
      Read installed Codex bundles under
      /Users/kjopek/.codex/plugins/cache/openai-primary-runtime/, specifically
      documents/26.909.12148/skills/documents/SKILL.md,
      pdf/26.909.12148/skills/pdf/SKILL.md,
      presentations/26.909.12148/skills/presentations/SKILL.md and
      spreadsheets/26.909.12148/skills/spreadsheets/SKILL.md plus their helpers.
      Include LibreOffice, Pandoc, Poppler, QPDF and Tesseract, and npm docx,
      pptxgenjs, pdf-lib, pdfjs-dist, @oai/artifact-tool, mathjax-full and sharp.
      Record source URL/path, hash, version, package
      distribution/import names, actual usage sites and external commands. Inspect
      referenced helpers, not only SKILL.md, and distinguish local helper modules from
      third-party dependencies. Treat setup-cowork as setup guidance, not a file engine.
      Include python-docx, openpyxl, XlsxWriter, python-pptx, pandas, numpy, lxml,
      Pillow, defusedxml, pypdf, fpdf2, reportlab, pdfplumber, pdfminer.six, pypdfium2,
      pdf2image, pytesseract and MarkItDown's selected document extras. Include their
      complete runtime dependency closure, fonts/data files, JS tools and native tools.
      Add the explicitly planned common extensions docxtpl, docxcompose, mammoth,
      xlrd, pyxlsb, odfpy, matplotlib, svglib, CairoSVG, uharfbuzz, PyMuPDF, pikepdf
      and OCRmyPDF. Do not install unrelated MarkItDown cloud/audio extras by default.
      Assign every observed helper/workflow a required capability, owning task,
      acceptance fixture and current evidence level. Use metadata parsing and Python
      ASTs, not import-name regexes. Lock extras/markers/transitive requirements for
      CPython 3.14.2 and the actual Pyodide ABI. Flag changed upstream pins rather
      than silently treating a moving latest version as the researched one.
      Completion requires zero unexplained inventory rows, not universal support.
    status:
      implement: open
      test: open

  - id: extend-declarative-package-profiles
    title: Extend existing provisioning with composable and reproducible document profiles
    prompt: |
      Extend packages/safe-bash/src/commands/python/provisioning.ts, installation.ts,
      provisioning-runtime.ts and their public contracts. The existing Python runtime,
      package cache, installer and documents profile are completed prerequisites;
      reuse them. Read applicable AGENTS.md and docs/python-documents registers.
      Add declarative selectable profiles for spreadsheets, word, presentations,
      pdf-core, pdf-extract, pdf-render, pdf-ocr, document-conversion and plotting.
      Preserve the existing documents profile's public behavior; introduce a separate
      full collection rather than silently downloading every heavyweight extra.
      Derive membership, validation, help and supported profile names from one
      registry. No provider-name branching, import scanning or one-off installer.
      Freeze the full resolved closure with versions, wheel URLs, hashes, runtime
      ABI, extras, package-data and build identity. Reject conflicting profiles before
      publishing an environment. Keep dependency resolution enabled, handle names
      and markers with maintained parsers, and preserve fpdf2 versus fpdf ownership.
      Support online provisioning, explicit compatible local wheels and complete
      offline reuse through existing transport/authorization/cache interfaces. Include
      model/font assets in offline completeness. Distinguish requested, resolved,
      installed and workflow-qualified state. Failed updates must not advertise a
      usable new environment; preserve the foundation's actual storage guarantees.
      Start with failing tests using in-memory storage/transport. Verify profile
      composition, conflicts, unavailable wheels, cancellation, corrupt caches,
      ABI changes, stale manifests and repeated invocations without state leakage.
      Keep non-Python startup free of Python or document downloads. No README edits.
    status:
      implement: open
      test: open

  - id: build-missing-wasm-dependencies
    title: Establish the build and distribution path for missing native Python dependencies
    prompt: |
      Implement the packaging work required by docs/python-documents dependency
      registers using the completed safe-bash Python installer and pinned Pyodide
      314.0.6, CPython 3.14.2, pyemscripten_2026_0 wasm32 baseline unless a separately
      qualified upgrade is necessary. Read applicable AGENTS.md. Keep build recipes
      and library assets outside lightweight root runtime wiring; avoid creating a
      new workspace unless ownership cannot fit existing packages/build declarations.
      Reuse matching indexed native wheels for lxml, Pillow, numpy, pandas,
      matplotlib, cryptography and PyMuPDF. Build missing native dependencies with
      the matching Pyodide cross-compilation toolchain and deterministic recipes.
      Required difficult families include PDFium/pypdfium2, QPDF/pikepdf, HarfBuzz,
      Cairo, Magika's ONNX runtime path and OCRmyPDF's selected native dependencies.
      This task establishes and proves the reusable build/asset pipeline with a
      representative required dependency. Complete each remaining family in its
      owning library task; do not duplicate the full ports here or make preliminary
      inventory completion imply their builds have passed.
      For source-only pure Python releases such as odfpy, build a reproducible wheel
      during asset provisioning, never run setup.py inside the user's shell.
      Track source and patch hashes, toolchain, ABI, build options, licenses, native
      dependency closure, package data, wheel integrity and supported entrypoints.
      Evaluate dynamic linking/ctypes assumptions explicitly; compiling C/C++ alone
      does not establish a working Python binding. Publish assets only through the
      repository's authorized GitHub release mechanism when separately requested.
      Use optional asset manifests and explicit transport. No native desktop wheel
      acceptance, runtime source compilation, forced deps=False or fake distributions.
      Add negative admission tests and positive real-runtime loading/operation checks
      for each produced wheel. Run npm run lint:workflows for workflow changes; do
      not write unit tests for GitHub workflows. Leave unbuilt dependencies open in
      the register and their owning tasks; the pipeline proof alone cannot close them.
    status:
      implement: open
      test: open

  - id: qualify-fonts-images-and-plots
    title: Provide reusable fonts, image codecs and plotting dependencies
    prompt: |
      Qualify Pillow, numpy, matplotlib, fonttools and defusedxml in ordinary Python
      scripts over safe-bash's canonical filesystem, using the locked dependency
      profiles in docs/python-documents. Read applicable AGENTS.md. Package a small,
      explicitly licensed font set and metadata under deterministic asset paths;
      expose configurable font directories rather than depending on host fonts.
      Record actual font coverage and fallback for Latin, CJK, Arabic/RTL, combining
      marks, symbols and emoji. Do not claim that font coverage supplies shaping.
      Exercise PNG/JPEG transparency, EXIF orientation, color profiles, image size,
      DPI and image decoding limits. Qualify matplotlib's noninteractive Agg output
      to PNG/SVG/PDF, deterministic cache/config locations and writable canonical
      temporary paths. Test numpy numeric/date data as input to office workflows.
      Add uharfbuzz, svglib and CairoSVG through real compatible dependencies for
      shaping and SVG conversion. Cover Cairo/cffi loading, external resource policy,
      text shaping and font embedding; a pure Python wrapper wheel is insufficient.
      Check license metadata and font redistributability from upstream sources.
      Use TDD with small in-memory original fixtures. Run real-codec/font integration
      separately and visually inspect rendered multilingual samples. Asset fetching
      must respect explicit transport and offline selection. Do not generate artwork
      for this task; any later new artwork follows the user's GPT Image reference rule.
    status:
      implement: open
      test: open

  - id: qualify-spreadsheet-libraries
    title: Support complete spreadsheet editing workflows and common input formats
    prompt: |
      Extend the completed Python document baseline with openpyxl, XlsxWriter,
      pandas and numpy workflows, plus xlrd for XLS, pyxlsb for XLSB and odfpy for
      ODS. Use existing safe-bash Python execution/provisioning and read applicable
      AGENTS.md. Test public python FILE and python3 invocations, not direct MEMFS
      library calls alone. Preserve ordinary distribution/import names and APIs.
      Create/edit/reopen multi-sheet XLSX with typed values, dates, formulas,
      styles, merged cells, freeze panes, named ranges, tables, validation,
      conditional formatting, hyperlinks, comments, charts and embedded images.
      Verify XlsxWriter output independently through openpyxl and OOXML structure.
      Exercise pandas engine selection and CSV/TSV dialects, quoting, embedded
      newlines, UTF-8/BOM, locale-independent types, missing data and identifier
      preservation. Test streaming/read-only/write-only modes without claiming
      pandas or ZIP libraries inherently avoid whole-input memory allocations.
      For XLSM/XLTX/XLTM, test macro/template preservation and extension handling;
      never execute macros. Existing complex workbook edits require before/after
      relationship/part inventories for pivots, slicers, drawings and external links.
      Report or refuse lossy workflows rather than silently stripping unsupported
      content. Do not claim XLS/XLSB writing from read-only engines.
      Check formula text separately from cached values. Formula calculation is owned
      by qualify-office-layout-and-recalculation and remains an open requirement.
      Use failing in-memory regressions, malformed/oversized inputs, delayed storage,
      read-only/quota failures and independent file readers. Record exact supported
      operations and preservation exceptions in docs/python-documents, no README edits.
    status:
      implement: open
      test: open

  - id: qualify-word-libraries
    title: Support Word authoring, templates, merging and structured edits
    prompt: |
      Qualify python-docx/lxml plus docxtpl, Jinja2, docxcompose and mammoth in the
      completed safe-bash Python runtime. Read applicable AGENTS.md and the locked
      profiles. Keep Python libraries usable directly; do not replace their imports
      with the existing TypeScript docx project or restart that project's plan.
      Exercise headings/styles, run formatting, numbered lists, table geometry,
      merged cells, sections/orientation, margins, headers/footers, images and alt
      text, hyperlinks, page fields, footnotes/endnotes, comments and tracked changes.
      Where a public library lacks an operation, provide original explicit OOXML
      helpers using parsed XML/ZIP relationships; do not claim python-docx supplies
      those APIs. Preserve unrelated parts and relationship targets during edits.
      Test template variable escaping, repeated rows, rich text, subdocuments and
      missing inputs; test merge collisions for styles, numbering, images, notes,
      headers and relationships. Mammoth conversion is semantic HTML extraction,
      not faithful page rendering. Keep macro/signature limitations visible.
      Cover redlines crossing runs/paragraph marks, insertion/deletion acceptance,
      comment anchors, fields versus displayed results, and headers containing
      sensitive text when applying privacy/redaction operations. Do not promise
      that deleting visible runs removes every occurrence in the document package.
      Use TDD with original memfs fixtures, compare OOXML preservation and reopen
      results independently. DOCX rendering and field/TOC updates remain separate
      engine capabilities. Record actual operation support in docs/python-documents.
      Do not copy installed/proprietary skill helpers or modify README files.
    status:
      implement: open
      test: open

  - id: qualify-python-presentations
    title: Add python-pptx with native charts, images and preservation checks
    prompt: |
      Add python-pptx==1.0.2 as an explicitly qualified presentation dependency on
      the completed safe-bash Python foundation; resolve its Pillow, XlsxWriter,
      lxml and typing-extensions closure from the shared profile. Read applicable
      AGENTS.md. Keep the existing TypeScript pptx implementation independent and
      reuse its format evidence only as an independent comparator where appropriate.
      Run ordinary scripts that create and edit slides, layouts/placeholders,
      text runs, bullets, tables, shapes, connectors, images/crops, groups, notes,
      hyperlinks, themes and presentation metadata. Add native charts with embedded
      XLSX data, multiple series and chart/axis relationships; reopen values and
      validate relationship ownership and content types, not only slide count.
      Evaluate template edits and merge/split/copy/reorder workflows explicitly:
      unsupported high-level library operations need original helpers or remain
      unsupported, never undocumented private-API promises. Inventory unchanged
      animations, transitions, media, comments, SmartArt, OLE and custom XML parts.
      Check lossless retention where claimed and disclose unsupported edits.
      Test EMU/point conversions, text fit, long text, missing fonts, Unicode,
      image handles, ZIP resources, corrupted files and delayed/cancelled writes.
      Native editable charts/tables must remain editable after export. Use failing
      unit tests before fixes and real-runtime public-command acceptance separately.
      Visually inspect rendered slides when a renderer is available; successful
      python-pptx reload or LibreOffice rendering alone does not prove PowerPoint
      accepts every chart. Record native-application checks separately. No README edits.
    status:
      implement: open
      test: open

  - id: qualify-pdf-generation
    title: Add ReportLab alongside fpdf2 for professional PDF generation
    prompt: |
      Qualify reportlab (research candidate 5.0.1) alongside existing fpdf2 in the
      completed safe-bash Python runtime. Read applicable AGENTS.md and lock actual
      versions/dependencies, including Pillow, charset-normalizer, fonttools and
      defusedxml as selected by metadata. ReportLab was explicitly unqualified by
      the original foundation and must now receive its own workflow evidence.
      Exercise canvas primitives, Platypus paragraphs/tables/page templates,
      pagination, repeated table headers, links/bookmarks, metadata, embedded images,
      font embedding/subsetting, page sizes, Unicode and multiline content. Compare
      with fpdf2's equivalent generation workflows without changing either API.
      Qualify shaping/RTL through uharfbuzz when requested; optional accel, bidi
      and Cairo rendering extras require their own native dependency evidence.
      Default success cannot depend on accelerators that have no compatible wheel.
      Check generated PDFs through independent pypdf/pdfminer readers and rendered
      page images. Test blank pages, missing font glyphs, text extraction order,
      clipping, long tables, transparent images and truncated input assets.
      PDF/A, PDF/UA, signatures and accessibility certification are separate
      standards claims; never infer them from embedding fonts or setting metadata.
      Use TDD with in-memory fixtures and explicit real-runtime integration. Keep
      render-and-inspect QA steps in docs/plans and results in docs/python-documents.
      No host subprocess fallback and no README edits.
    status:
      implement: open
      test: open

  - id: qualify-pdf-text-and-crypto
    title: Support PDF text extraction and encryption dependency paths
    prompt: |
      Qualify pdfminer.six (research candidate 20260107), pypdf encryption extras,
      and matching Pyodide cryptography/cffi dependencies using the completed Python
      runtime and canonical filesystem. Read applicable AGENTS.md. Resolve exact
      dependency constraints rather than assuming every pure Python PDF package is
      independent of native cryptography. Keep PDFium rendering as a separate task.
      Test text/layout extraction with rotated pages, columns, ligatures, embedded
      fonts, CJK/RTL samples, image-only pages and damaged character maps. Preserve
      coordinates and page units where returned. An empty text layer is a request
      for OCR or a documented empty result, not successful extraction of scanned text.
      Exercise supported password algorithms with known original fixtures: encrypt,
      read with correct password, wrong/missing password, decrypt and reopen.
      Ensure entropy/randomness paths function in each actual runtime; do not use
      deterministic production randomness merely to make tests repeatable.
      Test binary streams, lazy reads, seeks, malformed object streams and recovery
      after errors. Differentiate parsing limits, password failures and unsupported
      algorithms. Never log passwords in progress events or persisted evidence.
      Begin with failing in-memory tests and run matched-version real-runtime
      acceptance separately. Record algorithm and extraction scope explicitly in
      docs/python-documents. Do not claim cryptographic permissions prevent copying,
      or preservation of signatures after a document is modified. No README edits.
    status:
      implement: open
      test: open

  - id: support-pdfium-and-pdfplumber
    title: Resolve PDFium and deliver pdfplumber's full extraction and preview workflow
    prompt: |
      Deliver real pypdfium2 and pdfplumber support over the completed safe-bash
      Pyodide runtime. Read applicable AGENTS.md and docs/python-documents. Research
      found pdfplumber 0.11.10 requires pdfminer.six==20260107, Pillow>=12.2.0 and
      pypdfium2>=5.9.0; pypdfium2 is absent from the pinned Pyodide index. Its native
      binding requires an actual PDFium port and compatible ABI, not a fake package.
      Use build-missing-wasm-dependencies to provide/qualify PDFium, binding symbols,
      memory ownership, font/assets and supported Python API operations. A JS PDF
      renderer or PyMuPDF may serve a separate capability but cannot satisfy import
      pypdfium2 compatibility. Do not install pdfplumber with dependencies skipped.
      Exercise pdfplumber text/word/character extraction, crop, rotation, coordinate
      units, line/rectangle analysis and ruled/unruled table extraction. Exercise
      page.to_image plus table-debug overlays and pypdfium2 PDF rendering/extraction.
      Check text-only and scanned PDFs, nonzero crop boxes, malformed inputs,
      passwords, resource closure, image buffer lifetime and repeated/concurrent
      invocations. Preserve lazy canonical reads and bound requested render dimensions.
      Use independent expected tables/coordinates and visual previews, not the same
      extraction method as its own oracle. Compare MEMFS control versus canonical
      memory/delayed storage and test cancellation. Library import, extraction and
      rendering each need passing evidence. Keep this task open if the native port
      fails; document concrete build/runtime blockers without reducing the requirement.
    status:
      implement: open
      test: open

  - id: qualify-pdf-editing-and-forms
    title: Support PDF structure edits, AcroForms and applied redaction
    prompt: |
      Implement and qualify ordinary Python PDF editing workflows using pypdf,
      PyMuPDF and pikepdf with their real dependencies over canonical safe-fs.
      Read applicable AGENTS.md and docs/python-documents. PyMuPDF has a matching
      indexed wheel but its licensing/distribution choice must be recorded before
      bundling; pikepdf needs a qualified QPDF/native binding build. Keep libraries
      independently available, and report exact backend for higher-level workflows.
      Test merge/split/reorder/rotate/crop, overlays/watermarks, text/image extraction,
      metadata, outlines, annotations, attachments, object streams, repair and
      compression. Check resource/name collisions and duplicate form fields on merge.
      Handle AcroForm parent/kid inheritance, orphan widgets, repeated names,
      text/check/radio/choice fields, all pages, appearance streams and flattening.
      Verify filled values in an independent renderer; setting /V alone is not enough.
      For redaction, apply removal to content and relevant images/metadata, save
      without recoverable prior revisions when promised, and check extracted text,
      objects and rendered pixels. A covering rectangle is not redaction. Define
      limitations for XFA, signatures, encrypted files and incremental updates.
      Test malformed/cyclic PDFs, read-only/quota errors, oversized images, cleanup,
      resource release and unchanged input after a failed output operation according
      to the actual backend guarantees. Use TDD and real-runtime acceptance.
      Render every changed-page class for manual inspection and record structural
      versus visual versus native-reader evidence separately. No README edits.
    status:
      implement: open
      test: open

  - id: support-python-render-and-ocr-wrappers
    title: Give pdf2image and pytesseract real portable execution paths
    prompt: |
      Support pdf2image and pytesseract workflows in the completed safe-bash Python
      runtime. Read applicable AGENTS.md. Research confirms these wrappers launch
      Poppler and Tesseract using subprocess, which the foundation deliberately
      does not expose as an ambient native process escape. Installing their wheels
      alone does not satisfy this task. Do not enable arbitrary subprocess globally.
      Provide qualified WASM Poppler/Tesseract engines and an explicitly scoped
      compatibility mechanism for these wrappers, or maintain transparent patched
      distributions with a narrow injected engine backend. Preserve supported public
      APIs, version identity/provenance and error semantics; document patched scope.
      Do not masquerade a replacement renderer as the original library or silently
      execute host binaries. Any separately offered external engine needs explicit
      configuration and remains a different deployment capability.
      Cover pdfinfo, pdftoppm/pdftocairo options actually used by pdf2image, byte/path
      inputs, DPI, page ranges, crop boxes, transparency, output formats, passwords,
      timeouts and thread_count semantics. Do not silently ignore requested concurrency.
      Cover pytesseract language/config handling, text, TSV/hOCR, boxes, orientation,
      timeout and searchable PDF output. Pin language packs and make them available
      offline. Implement only admitted engine commands, safe argv handling, canonical
      temporary files, bounded transfers and cancellation without generic shell exec.
      Qualify multilingual original scans and rotated/noisy pages against explicit
      text/box expectations and manual rendered review. Keep unsupported API paths
      and native-port blockers open; neither an import nor graceful refusal is a pass.
    status:
      implement: open
      test: open

  - id: qualify-searchable-pdf-workflows
    title: Add OCRmyPDF with its complete processing dependency graph
    prompt: |
      Qualify OCRmyPDF for searchable-PDF workflows over the completed safe-bash
      Python runtime, using actual compatible Tesseract, pikepdf/QPDF, PDFium,
      HarfBuzz and image dependencies. Read applicable AGENTS.md and lock the selected
      release metadata; the researched 17.11.0 release includes fpdf2, img2pdf,
      pdfminer.six, pi-heif, pikepdf, Pillow, pluggy, pydantic, pypdfium2, rich and
      uharfbuzz. Discover optional external tools from that exact version instead of
      assuming a historical Ghostscript dependency or pretending it is pure Python.
      Use the narrow portable engine integration from the task
      support-python-render-and-ocr-wrappers. Audit process pools, job control,
      plugins and external optimization
      calls; implement supported semantics without granting ambient host execution.
      Exercise image-only and mixed PDFs, existing text handling, rotation/deskew,
      page selection, language packs, OCR text alignment, searchable output, metadata,
      bookmarks, page sizes and original image preservation. Compare OCR boxes to
      rendered geometry, not only a nonempty text string. Check confidence on fixed
      fixtures with declared tolerances, not a promise of perfect recognition.
      Verify cancellation, cleanup, bounded page batches and offline operation.
      Standards such as PDF/A require an independent validator and its own qualified
      engine; unsupported standards options must fail explicitly. Avoid adding GUI,
      watcher, cloud or webserver extras to the profile. Use fast in-memory unit
      doubles and separate real-runtime integration. Missing required dependencies
      or workflow paths keep this task open and block full collection acceptance.
    status:
      implement: open
      test: open

  - id: qualify-markitdown-and-conversion
    title: Support MarkItDown's office and PDF conversion paths without hidden native gaps
    prompt: |
      Qualify MarkItDown's xlsx, xls, docx, pptx and pdf extras and their complete
      transitive dependencies in the completed safe-bash Python runtime. Read
      applicable AGENTS.md and docs/python-documents. The researched 0.1.7 release
      requires magika~=0.6.1 in its base dependencies, and constructs Magika in its
      normal initialization. The compatible 0.6.3 line depends on ONNX Runtime,
      which is absent from the pinned Pyodide index. Do not skip or stub that dependency.
      Deliver a compatible ONNX/Magika engine and model package through the native
      build/profile tasks, with faithful inference and model-data loading. An explicit
      content-type-only reduced converter can be offered separately but is not full
      MarkItDown support. Pin the compatible mammoth version required by the selected
      MarkItDown extra rather than blindly choosing the newest common package.
      Exercise MarkItDown's normal Python API and console entrypoint using files,
      bytes/streams, names with spaces and unknown extensions. Preserve meaningful
      sheet/slide boundaries, tables, text ordering, hyperlinks and Unicode in output.
      Test PDF extraction versus OCR as separate capabilities; semantic Markdown is
      not a layout-preserving round trip. Verify absent extras fail actionably.
      Add common standalone mammoth/docxtpl/docxcompose and pandas conversion
      interoperability cases without routing ordinary Python calls through TS tools.
      Keep cloud/audio/LLM extras opt-in and outside required document defaults.
      Resolve entrypoint registration through existing declarative shell mechanisms;
      no per-library hardcoded command switches. Use TDD and real-runtime fixture
      evidence. Document native/model blockers instead of claiming partial imports pass.
    status:
      implement: open
      test: open

  - id: integrate-non-python-skill-tools
    title: Account for JavaScript authoring and existing office command packages
    prompt: |
      Integrate the non-Python tooling required for actual document-skill workflows
      alongside the completed Python runtime. Read applicable AGENTS.md and existing
      docs/specs/office-cli.md, docs/specs/office-sdk.md and TypeScript docx/pptx plans.
      Anthropic's researched authoring paths use npm docx and pptxgenjs, while its
      PDF reference uses pdf-lib and pdfjs-dist. Installed Codex spreadsheet and
      presentation skills prefer @oai/artifact-tool JavaScript. This is not evidence
      that these packages can be loaded with micropip or redistributed by poe-code.
      Evaluate JS package exports, browser/worker support, filesystem assumptions,
      font/image dependencies and public installation/licensing availability. Keep
      optional dependencies lazy and use existing node/JS execution and package
      ownership. Never add a pretend @oai/artifact-tool shim or a required inaccessible
      service. If unavailable, record the exact tool-parity gap and separately test
      equivalent workflows through accessible original tools.
      Interoperate through canonical XLSX/DOCX/PPTX/PDF bytes and explicit metadata,
      with no second competing office document model. Reuse existing TS commands
      only for their established contracts; do not reimplement or rename them here.
      Test editable native tables/charts, embedded workbook data, OOXML relationship
      integrity, text geometry and source preservation across Python/JS round trips.
      Qualify rendering dependencies separately. Follow TDD for new adapters and
      include public CLI/SDK parity. Report library/API compatibility separately from
      artifact/workflow parity; unavailable proprietary tooling stays visible.
    status:
      implement: open
      test: open

  - id: qualify-office-layout-and-recalculation
    title: Deliver actual office rendering, field updates and spreadsheet calculation
    prompt: |
      Provide the engine capabilities required beyond Python OOXML libraries:
      DOCX/PPTX/XLSX rendering, Office-to-PDF, sheet previews, DOCX field/TOC updates
      and XLSX formula recalculation with stored cached values. Read applicable
      AGENTS.md and docs/python-documents. Existing Python file support does not
      supply these engines. Anthropic and Codex helpers call LibreOffice/Poppler;
      Codex artifact-tool also has its own calculation/rendering surfaces.
      Prove an accessible portable engine for each required capability before
      promising integration. Evaluate WASM builds, browser engines or explicit
      adapters using measured compatibility, asset size, fonts and licensing.
      Do not silently shell out to host LibreOffice/Pandoc, upload files to a service
      or treat a package named like a converter as proof its binary runs in Pyodide.
      An optional external engine, if separately authorized/configured, must have a
      distinct deployment identity, file-transfer boundary and declared limitations;
      it cannot count as portable Python support. No broad subprocess escape.
      Test cross-sheet/named/range formulas, dates, errors, cached results, input
      mutations and reopen with data_only=True. Enumerate engine support for dynamic
      arrays, lookups, external links, volatile/iterative formulas, data tables,
      pivots and macros. Never silently rewrite formulas to hide engine failures.
      Test every required rendered document class for pagination, fonts, charts,
      tables, crop/rotation, overflow and missing images. Preserve source files;
      render/recalculate explicit output copies and inspect package changes.
      Use independent calculation controls and native-app samples when available.
      Leave this task open if a required portable engine is unavailable; an extraction
      preview or externally rendered QA image does not close the product requirement.
    status:
      implement: open
      test: open

  - id: expose-library-capabilities-through-sdk-and-cli
    title: Expose profiles, assets and truthful workflow capabilities in SDK and CLI
    prompt: |
      Expose document-library integration through existing pythonCommands options,
      PythonPackageOptions, public safe-bash exports, src/sdk/bash.ts and
      src/cli/commands/bash.ts. Read applicable AGENTS.md. CLI must call the SDK;
      all configuration must have argument-based equivalents. Reuse established
      python/python3 and installer behavior rather than introducing another interpreter.
      Add profile/locked-environment selection, explicit font/model asset paths,
      runtime/index identity, offline mode and any qualified engine configuration.
      Generate valid profile/capability names and help from the declarative registry.
      Provide machine-readable capability discovery showing installed libraries,
      exact versions, deployment, operation support and unresolved requirements.
      Distinguish unavailable dependency, incompatible ABI, missing font/language
      pack, unsupported renderer/formula and absent explicitly selected engine.
      Keep discovery lightweight; do not download assets just to answer help.
      Preserve binary stdout and clean JSON modes. Use design-system progress for
      initialization/download/rendering/OCR; propagate cancellation and errors.
      Respect explicit flags and interactive defaults only with --yes as applicable.
      Verify browser/Node export boundaries and actual runtime restrictions rather
      than advertising workerd because a browser bundle imports. No secret ambient
      host access, unrequested network uploads or fake resource-limit guarantees.
      Use failing CLI/SDK/public-consumer tests and maintained scoped checks.
      Inspect help, missing-dependency and progress output through
      npm run screenshot-poe-code -- <command>. Do not write screenshot tests.
    status:
      implement: open
      test: open

  - id: write-original-document-skills
    title: Add original skills that use the verified libraries and complete QA workflows
    prompt: |
      Write original poe-code skills for spreadsheet, Word, presentation and PDF
      work using the qualified Python profiles and explicitly available engines.
      Read applicable AGENTS.md and existing skill-template/loading conventions.
      Edit source templates named SKILL_ and run npm run sync-skills; never edit
      only installed copies. Do not copy Anthropic/Codex proprietary prompts/helpers.
      Provide accurate triggers and self-contained examples of reading, creating,
      editing, validating, rendering and delivering the appropriate file types.
      Cover formulas/caches and preservation for XLSX; styles, redlines/comments
      and fields for DOCX; native charts/tables/notes and preservation for PPTX;
      structure edits, forms, extraction, rendering, applied redaction and OCR for PDF.
      Route by available capabilities, never guessed installed packages. Ordinary
      Python examples retain their real APIs. Missing engines lead to actionable
      capability errors, not false claims that the task is done after saving a file.
      Include source-preserving edits, Unicode/font checks, independent reopen,
      targeted visual inspection and a final artifact verification step. Make QA
      a Markdown procedure in docs/plans, not a generated TypeScript QA program.
      New artwork follows the user's GPT Image reference/model rule. Do not install
      unrelated Cowork plugins or cloud integrations as part of document support.
      Test skill discovery/sync through maintained routes and verify agent definition
      changes with the existing test command using mocked LLM/snapshot abstractions.
      Keep product copy focused on supported use, not competitor branding. Publish
      usage/reference documentation outside README unless permission is supplied.
    status:
      implement: open
      test: open

  - id: qualify-public-workflows-and-preservation
    title: Run complete public-command and cross-library document acceptance
    prompt: |
      Verify docs/python-documents dependency/workflow registers through built
      public safe-bash exports and CLI after integration. Treat the original
      Pyodide foundation as complete; focus on the added libraries and workflows.
      Read applicable AGENTS.md. Keep real-runtime integration outside fast unit
      discovery and provision assets separately. QA procedures stay in docs/plans.
      Test ordinary Python script files, modules and installed entrypoints, including
      heredocs, pipes, binary redirects, Unicode paths and repeated invocations.
      Run pinned Node workers and the actual supported browser-worker deployments.
      Cover canonical memory/delayed backends and read-only/mount/quota compositions,
      cross-command visibility, package data, temporary files, resource closure,
      cancellation during native work and recovery after failure. Use MEMFS only
      as a diagnostic control. Test complete offline execution after provisioning.
      Build original representative DOCX/XLSX/PPTX/PDF fixtures plus properly licensed
      external edge cases. Inventory every fixture's provenance and expected results.
      Include data-to-workbook-to-slide, workbook-to-Word table, DOCX/PPTX-to-PDF,
      PDF-tables-to-XLSX, PDF forms and multilingual scanned-PDF OCR workflows.
      Check independently reopened values, formulas/caches, relationships, editable
      objects, font/image resources, metadata and unchanged opaque parts.
      Manually render and inspect all representative page/slide/sheet classes; retain
      screenshots and bounded evidence. Native Office checks are separate from
      XML/schema/LibreOffice checks. A parser accepting a file does not prove fidelity.
      Map every required workflow to an actual pass/failure/blocked result with
      runtime and backend versions; no skipped or unavailable cases counted as passes.
    status:
      implement: open
      test: open

  - id: verify-capacity-and-isolation
    title: Verify document workload budgets, concurrency and offline asset behavior
    prompt: |
      Measure the new document-library workload on the completed safe-bash runtime.
      Read applicable AGENTS.md and docs/python-documents. Preserve the baseline's
      actual trust model and resource guarantees; do not claim a hostile-code sandbox
      or hard memory quota without enforcing and proving one. Inspect native extension,
      renderer, OCR/model and JS bridge paths for unintended host/network access.
      Test ZIP expansion bombs, huge worksheet dimensions, giant page/image requests,
      excessive XML/PDF recursion, malformed relationships, external resource references
      and XML entities. Use format-aware size/depth checks where provided, with an
      explicit failure before unsafe resource commitment when that guarantee is made.
      Measure cold/warm installation and execution, compressed/expanded assets,
      per-worker Wasm memory, model/font caches, representative documents and bounded
      concurrent jobs. Record hardware/runtime/input dimensions and actual numbers;
      choose enforceable defaults from measurements, not invented performance targets.
      Confirm one caller's cancellation does not terminate another; no queued pipeline
      consumer deadlock, stale worker handles or late writes after termination.
      Validate offline completeness across runtime, native wheels, fonts and OCR/ONNX
      models; test eviction, missing assets, corruption and ABI changes. Avoid copying
      all documents or package state per call when immutable reuse is available, but
      preserve per-invocation Python isolation. Use narrow in-memory unit regressions
      and explicit integration measurements. Every failed required budget/lifecycle
      assertion remains open; thresholds are versioned alongside the evidence.
    status:
      implement: open
      test: open

  - id: reconcile-full-library-support
    title: Close every required library and workflow row with evidence
    prompt: |
      Audit completed integration against docs/python-documents dependency and
      workflow registers and the original request for all document-skill Python
      libraries. Read applicable AGENTS.md. Account for every direct/transitive
      dependency, selected extra, binary, font/model asset and public workflow.
      Require installation, import, package-data access, actual operations and
      output verification in every advertised deployment. Separate API-compatible
      ports, patched distributions, workflow alternatives and external engines.
      Report portability, fidelity and licensing/distribution availability per row.
      Full support requires all mandatory rows to pass; PDFium, Magika/ONNX,
      Poppler/Tesseract wrappers, OCRmyPDF and office rendering/recalculation may
      not disappear into an optional footnote to obtain a green completion report.
      Complete focused package checks plus full maintained npm test and repository
      lint for this cross-workspace integration, with uncached maintained dependency
      closure. Use npm run build for normal workspace/root build stages, preserve
      maintained Git-hook environment handling, and run lint:workflows where needed.
      Do not write redundant tests for plan/config-only edits. Complete CLI screenshot
      and document visual checks where behavior changed; record checks not run.
      Update docs/plans/python-document-libraries.md readiness/task status only from
      evidence, and provide usage docs outside README unless authorized. This task
      authorizes no push/release. If delivery is later requested, use atomic owned
      commits on main and separately verify remote main and monitor GitHub release
      publication; local checks are not a published feature.
    status:
      implement: open
      test: open
---

# Python document libraries after the Pyodide foundation

## Scope and planning assumption

The user explicitly considers [pyodide-safe-bash.md](pyodide-safe-bash.md) complete.
This is its follow-on integration plan. That filename identifies the prerequisite,
not an instruction to replace its work with a different topic. Existing foundation
files and unrelated working-tree changes remain untouched.

The objective is ordinary scripts such as `python build_report.py` using real
Python libraries to read, create, edit and validate spreadsheets, Word documents,
presentations and PDFs on the same filesystem as the shell. It also includes the
rendering, recalculation and OCR machinery that makes document skills useful.
Python packages must remain available directly, even where a TypeScript command
already handles the same file format.

“All Python libs” means every library and selected runtime dependency discovered
in these document workflows, plus the common extensions explicitly listed here.
It is a completion requirement, not permission to quietly reduce the list to easy
pure-Python packages. It cannot truthfully mean every package on PyPI or every
desktop Python API: Pyodide requires compatible native builds and has operating
system limitations. General compatible-wheel installation remains available.
Required libraries without a working build or API path remain open work.

Planning is complete when this researched, executable draft validates. Product
integration is complete only when the final task's evidence gates pass. No feature
implementation, commit, push or release is authorized merely by writing this plan.

## Investigation method and evidence strength

Research date: **2026-09-13**.

The investigation inspected all four current Anthropic document skill directories,
their Markdown references and Python helpers, rather than relying on the trigger
descriptions in the request. It fetched 60 relevant source/reference/license files
at a fixed revision for temporary inspection. Python AST import inventories were
cross-checked with shell invocations and prose examples; local helper imports such
as `office`, `validators` and `runtime_helpers` are not PyPI dependencies.

For Codex, the installed document/PDF/presentation/spreadsheet SKILL.md files and
helper imports were inspected, along with presentation implementation guidance
and the spreadsheet Artifact Tool quick start. These are evidence about this
installed **26.909.12148** bundle, not a claim that every Codex version uses the
same tools. Artifact-specific authoring procedures were inspected as sources;
this planning task does not create office artifacts or invoke those authoring flows.

The investigation also read the existing Python implementation/provisioning and
its qualification records, fetched the exact Pyodide package index, queried PyPI
release metadata, and inspected wrapper wheel sources where metadata hid runtime
requirements. A compatible wheel or index entry establishes availability, not a
passing workflow. Historical runtime checks are attributed to their original scope.

Evidence levels used by the implementation register:

| Level | Meaning | Does not establish |
| --- | --- | --- |
| Source observed | Skill/helper calls the library or executable | Availability in our runtime |
| Metadata compatible | Release/ABI/dependency artifacts appear suitable | Installation or import success |
| Installed/imported | Real pinned runtime installs and imports | Useful operations or output fidelity |
| Operation verified | Specific original fixture passes through canonical storage | Uncovered APIs, rendering or all platforms |
| Artifact verified | Independent structure/content checks and applicable visual checks pass | Universal native-app equivalence |
| Qualified | All declared operation/deployment cases pass and assets are distributable/provisionable | Arbitrary upstream APIs outside the declared scope |

## What the skills actually use

### Anthropic: pinned upstream revision

Revision: [`34040c9c568585f6929bedeaad110ad08f079624`](https://github.com/anthropics/skills/tree/34040c9c568585f6929bedeaad110ad08f079624).

| Skill | Observed Python dependencies | Other essential machinery | Integration consequence |
| --- | --- | --- | --- |
| [xlsx](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/xlsx/SKILL.md) | openpyxl; pandas; MarkItDown; helper validators use lxml/defusedxml | `recalc.py` invokes LibreOffice; bundled soffice wrapper has platform/compiler assumptions | Formula generation and calculation need separate qualification |
| [docx](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/docx/SKILL.md) | lxml/defusedxml and ZIP/XML helpers | npm `docx` for creation, Pandoc for reading, LibreOffice and Poppler for layout/revision processing | Python-docx alone does not reproduce this entire pipeline |
| [pptx](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/pptx/SKILL.md) | MarkItDown[pptx], Pillow, lxml, defusedxml | npm `pptxgenjs`, LibreOffice, Poppler; XML/package validation | python-pptx is useful and needed by extraction/QA dependencies, but is not the primary authoring tool here |
| [pdf](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/pdf/SKILL.md) and [reference](https://github.com/anthropics/skills/blob/34040c9c568585f6929bedeaad110ad08f079624/skills/pdf/reference.md) | pypdf, pdfplumber, reportlab, pandas, numpy, Pillow, pypdfium2, pdf2image, pytesseract | Poppler, QPDF, Tesseract; JS pdf-lib/pdfjs-dist | Extraction, rendering, editing and OCR have distinct dependency graphs |

Specific helper evidence: `xlsx/scripts/recalc.py`, the shared
`scripts/office/soffice.py` and validators, `docx/scripts/accept_changes.py`,
`pptx/scripts/thumbnail.py`, `pdf/scripts/convert_pdf_to_images.py`,
`pdf/scripts/extract_form_structure.py` and the fillable-field scripts.

The user also mentioned setup-cowork. It configures plugins/tools and onboarding;
it does not provide a document engine. Installing Cowork or copying its onboarding
flow would not solve any Python library compatibility requirement here.

### Codex: installed source inspected

Paths below are relative to
`/Users/kjopek/.codex/plugins/cache/openai-primary-runtime/`.

| Bundle source | Actual preferred tools and helper dependencies |
| --- | --- |
| `documents/26.909.12148/skills/documents/SKILL.md` | python-docx for authoring; lxml OOXML helpers; openpyxl for workbook-table import; `render_docx.py` uses pdf2image and LibreOffice; Pillow for image comparison; mathjax-full/sharp for equation-image workflows |
| `pdf/26.909.12148/skills/pdf/SKILL.md` | reportlab, pdfplumber, pypdf; `pdftoppm`/`pdfinfo` from Poppler; AcroForm recovery, appearance and flattening checks |
| `presentations/26.909.12148/skills/presentations/SKILL.md` | JavaScript `@oai/artifact-tool` for authoring, explicitly not python-pptx authoring; helper scripts nevertheless import python-pptx, numpy, Pillow, lxml, pypdf and pdf2image; rendering uses LibreOffice/Poppler |
| `spreadsheets/26.909.12148/skills/spreadsheets/SKILL.md` | JavaScript `@oai/artifact-tool` for authoring/calculation/rendering; openpyxl/XlsxWriter/pandas authoring only as directed or fallback; bundled pandas/numpy/pypdf/python-docx/reportlab for other processing; docx/pdf-lib/pdfjs-dist also listed as JS dependencies |

The spreadsheet quick start identifies Artifact Tool API documentation version
**2.8.58+**; this is not proof of an installed package version, an unrestricted npm
distribution, or full formula/export support. Its own guidance records formula
and PivotTable export limitations. Do not build a mandatory dependency around an
assumption that the private runtime package can be redistributed.

SHA-256 of inspected SKILL.md files, for reproducible follow-up:

| Bundle | SHA-256 |
| --- | --- |
| documents | `db351f7db520a130f33227999e55d9cc61a95b93660e1506d9a9a9fe90c9f916` |
| pdf | `65f4a606b5ec8e564d6d9782254b34c2bb2ce0a573e9349fb46b1173449c72fa` |
| presentations | `e0d28835f8ada4ef5f41ab0425dd818d9c9ab9a66a8e47df2cee5add15cce32f` |
| spreadsheets | `499172cadf77be41b6ec7d87981463aec0859e10aba9cc0b864143e42955474b` |

## Existing foundation: reuse, do not rebuild

The working tree already provides optional `pythonCommands`, fresh interpreter
workers, canonical filesystem I/O, an explicit trusted Node worker adapter,
requirements/local-wheel provisioning, transport authorization, integrity/cache
handling and an opt-in `documents` profile. Relevant files:

- `packages/safe-bash/src/commands/python/{index,node,worker,provisioning,provisioning-runtime,installation}.ts`
- `packages/safe-bash/docs/{pyodide,python-packages}.md`
- `packages/safe-fs/src/python/` and canonical contracts
- `src/sdk/bash.ts`, `src/cli/commands/bash.ts`
- `packages/safe-bash/tests/integration/pyodide-runtime/`

The existing profile pins python-docx 1.2.0, lxml 6.0.2, openpyxl 3.1.5,
XlsxWriter 3.2.9, pypdf 6.18.1, fpdf2 2.8.8, Pillow 12.2.0, fonttools 4.65.0,
defusedxml 0.7.1, et-xmlfile 2.0.0 and typing-extensions 4.16.0. Keep their tested
behavior until an intentional upgrade is qualified. The older browser evidence
also exercised PyMuPDF but did not make it part of this default profile.
ReportLab was explicitly not evaluated in that foundation's original qualification.

The baseline prohibits native process fallback and documents actual trust limits.
This plan does not weaken those guarantees merely because upstream helper scripts
call subprocess. Existing TypeScript docx/pptx and proposed Pandoc work remain
separate projects with shared artifact interoperability, not replacements for the
requested Python APIs.

### Additional real-runtime probes performed during this planning task

The investigation executed ordinary staged Python scripts through the current
`Shell` and `pythonCommands`, using `createNodePythonWorker({ trustedPython: true,
runtimeModuleURL })`, the isolated installed Pyodide **314.0.6** runtime, authorized
CDN/PyPI transport and a canonical `MemoryFileSystem` mounted at `/work`. The
interpreter reported **CPython 3.14.2**. These were actual library operations,
not metadata-only checks or direct Pyodide MEMFS examples.

| Probe | Observed result |
| --- | --- |
| python-pptx 1.0.2 | Guest exit 0: create a slide with a clustered-column chart, categories A/B and values 2/3; save `/work/probe.pptx`; reopen and verify chart values `[2, 3]` |
| ReportLab 5.0.1 | Guest exit 0: generate `/work/probe.pdf` with a paragraph and a table |
| pdfminer.six 20260107 | Extract expected paragraph text from that generated PDF |
| pypdf 6.18.1 | Independently extract the same expected paragraph text |
| pdfplumber 0.11.10 | Guest exit 1 during ordinary dependency-resolving installation, before the import probe ran |

The pdfplumber failure was:

```text
ValueError: Can't find a pure Python 3 wheel for 'pypdfium2>=5.9.0'.
```

The successful combined probe resolved lxml **6.0.2** and Pillow **12.2.0**.
Dependencies were not skipped. Generated documents stayed in canonical memory;
no product source or host document files were changed. The PPTX check did not
visually render the chart; the PDF check did not inspect table layout. These
results establish narrow usable operations and a concrete current installation
blocker, not complete library qualification, all deployments, or universal
impossibility of porting PDFium. Their corresponding implementation tasks remain
open for full coverage, packaging, public surfaces and visual QA.

To reproduce during implementation, configure the existing Python plugin with
explicit package pins and the established origin authorizer for
`https://cdn.jsdelivr.net`, `https://pypi.org` and
`https://files.pythonhosted.org`. Stage source as `Uint8Array` in canonical storage
and execute `python /work/probe.py`. Use python-pptx's `ChartData` and
`XL_CHART_TYPE.COLUMN_CLUSTERED`, ReportLab's `SimpleDocTemplate`, `Paragraph` and
`Table`, then independently read with `pdfminer.high_level.extract_text` and
`pypdf.PdfReader`. Run the normal `pdfplumber==0.11.10` installation in a fresh
environment to preserve the negative control. The maintained acceptance task
must turn these probes into versioned fixtures; this report is not their replacement.

## Package compatibility findings

Exact [Pyodide 314.0.6 lockfile](https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide-lock.json)
queried during research:

- CPython **3.14.2**, ABI **2026_0**, platform **emscripten_5_0_3**, architecture **wasm32**.
- Lockfile SHA-256: `3fdaef09e9e365c85e002737720f8d0ab8f278c1c244a2dde6a37663cf488ad4`.
- Upstream package availability is checked against this exact index, not a generic
  package-list page that could refer to a different runtime.

`Indexed` below means an artifact exists for the selected runtime. `Candidate`
means metadata/source inspection, not a compatibility certification. Pure Python
packages can be absent from the index and still install through micropip.

| Library family | Research finding | Required treatment |
| --- | --- | --- |
| python-docx / openpyxl / XlsxWriter / pypdf / fpdf2 | Already pinned in baseline | Extend operations and preservation evidence; retain normal imports |
| python-pptx 1.0.2 | Pure wheel; Pillow, XlsxWriter, lxml, typing-extensions dependencies | Add actual presentation/chart/template workflow qualification |
| lxml 6.0.2 / Pillow 12.2.0 | Indexed native wheels | Reuse matched ABI; test package resources and image codecs |
| numpy 2.4.6 / pandas 3.0.2 | Indexed; pandas depends on numpy/dateutil/pytz | Data and engine-specific spreadsheet qualification |
| matplotlib 3.10.8 | Indexed with native/data dependencies | Noninteractive plotting, font caches and exports |
| reportlab 5.0.1 | Pure wheel; Pillow and charset-normalizer; optional native extras | Base generation plus separately qualified shaping/bitmap paths |
| pdfminer.six 20260107 | Pure wheel with cryptography dependency | Match cryptography/cffi; test extraction and encrypted inputs |
| cryptography 47.0.0 / cffi 2.0.0 | Indexed native wheels | Test supported algorithms, entropy and runtime binding paths |
| pdfplumber 0.11.10 | Requires pdfminer.six==20260107, Pillow>=12.2.0, pypdfium2>=5.9.0 | Resolve PDFium even if text extraction appears usable alone |
| pypdfium2 5.13.0 | Native-platform wheels; absent from pinned index | Build PDFium and compatible binding; do not install a dummy substitute |
| PyMuPDF 1.27.2.2 | Indexed native wheel; prior scoped runtime evidence | Qualify operations and make an explicit distribution/license choice |
| pdf2image 1.17.0 | Pure wrapper; source invokes pdfinfo/pdftoppm/pdftocairo through Popen | Qualified portable Poppler and wrapper integration |
| pytesseract 0.3.13 | Pure wrapper; source invokes Tesseract through subprocess | Qualified portable OCR engine, language packs and wrapper integration |
| MarkItDown 0.1.7 | Base magika~=0.6.1; document extras pull converters | Full selected-extra closure, normal initialization and entrypoints |
| Magika 0.6.3 | Compatible dependency line requires ONNX Runtime; not indexed | Native/portable inference path and model resources, not a classifier stub |
| docxtpl 0.20.2 | Pure wheel; python-docx/Jinja2/lxml; subdoc extra needs docxcompose | Template and subdocument qualification |
| docxcompose 2.2.0 | Pure wheel; Babel/lxml/python-docx | Merge numbering/styles/relationships and resource handling |
| mammoth 1.12.2 | Pure wheel; cobble | Standalone candidate; MarkItDown pins ~=1.11.0 so resolve that profile's compatible version |
| xlrd 2.0.2 / pyxlsb 1.0.10 | xlrd indexed; pyxlsb pure wheel | Legacy input reading; no unsupported writer claims |
| odfpy 1.4.1 | Current release has source archive and no wheel | Build a reproducible pure wheel outside runtime and qualify ODS |
| svglib 2.2.0 | Pure wheel; reportlab/lxml/Pillow/cssselect2/tinycss2; optional bitmap backend | SVG conversion and explicit raster extras |
| CairoSVG 2.9.1 | Pure wrapper; cairocffi/native Cairo not in queried index | Port/qualify actual native dependency chain |
| uharfbuzz 0.56.1 | Native wheels; not indexed | Compile binding/HarfBuzz for shaping workflows |
| pikepdf 10.13.0.post1 | Native QPDF binding; not indexed | Build real native dependency and qualify repair/editing |
| OCRmyPDF 17.11.0 | Pure orchestration wheel with multiple native runtime dependencies | Full exact-release graph, portable job/engine integration |

These version observations are research inputs, not a prescription to replace
working baseline pins with “latest.” The lock task must choose one mutually
compatible graph. In particular, indexed fonttools is **4.62.1** whereas the
existing profile intentionally pins **4.65.0** from a pure wheel; profile composition
must resolve that difference explicitly.

Dependency facts were obtained from first-party release metadata, for example
[python-pptx](https://pypi.org/pypi/python-pptx/1.0.2/json),
[ReportLab](https://pypi.org/pypi/reportlab/5.0.1/json),
[pdfplumber](https://pypi.org/pypi/pdfplumber/0.11.10/json),
[pdfminer.six](https://pypi.org/pypi/pdfminer.six/20260107/json),
[MarkItDown](https://pypi.org/pypi/markitdown/0.1.7/json),
[Magika](https://pypi.org/pypi/magika/0.6.3/json) and
[OCRmyPDF](https://pypi.org/pypi/ocrmypdf/17.11.0/json).
The first task retains full transitive metadata and wheel hashes rather than
depending on this human-readable table as a complete lockfile.

### Concrete traps found by inspecting implementation

1. `pdfplumber/display.py` imports pypdfium2. `Page.to_image()` loads that display
   path. A narrowly successful text import does not demonstrate previews, and a
   normal installer still has to satisfy pdfplumber's declared PDFium dependency.
2. `pdf2image/pdf2image.py` runs Poppler with `Popen`; `pytesseract/pytesseract.py`
   uses subprocess to execute Tesseract and query languages/version. Their pure
   wheel tags say nothing about executable availability in the sandbox.
3. MarkItDown imports Magika and constructs `Magika()` during normal initialization.
   Avoiding PDF conversion does not by itself remove the base inference dependency.
4. Installed Codex presentation QA imports python-pptx even though its primary
   presentation authoring instructions prefer Artifact Tool. Inspecting only the
   authoring recommendation would omit a required Python library.
5. LibreOffice/Poppler outputs are used for QA and calculation. A save/reopen test
   cannot replace the missing rendering or calculation stage. Nor does a QA image
   produced outside safe-bash prove that its renderer is a product capability.

## Architecture decisions

The integration extends the existing package provisioner, not the interpreter or
filesystem architecture. Package definitions are declarative and profiles resolve
through a single registry. Library imports continue to work normally. Root code
wires the public CLI/SDK; format-specific adapters remain in their owning packages.

There are four capability boundaries:

| Boundary | Examples | Contract |
| --- | --- | --- |
| In-process Python libraries | python-docx, openpyxl, python-pptx, pypdf, reportlab | Ordinary import/API, canonical files, qualified wheel closure |
| Python native extensions | lxml, Pillow, PDFium, QPDF, HarfBuzz, ONNX | Exact Wasm ABI, real binding behavior, memory/resource cleanup |
| Engine-dependent workflows | Office rendering/calculation, Poppler, Tesseract | Explicit engine and asset availability; preserve API/error semantics |
| Optional JS tooling | docx, pptxgenjs, pdf-lib, pdfjs-dist, Artifact Tool if accessible | Separate runtime/export/license qualification and shared artifact bytes |

An API-compatible port, a patched wrapper, an alternative workflow and an external
engine are different delivery types. Capability discovery must make that clear.
For example, rendering through PyMuPDF can complete a supported rendering workflow,
but it does not make `import pypdfium2` compatible. A scoped subprocess-compatible
engine bridge must never provide a general host shell to Python code.

Do not build an omnibus document abstraction or duplicate the TypeScript office
models. Add small adapters only where an actual workflow crosses a runtime/engine
boundary. No function that merely forwards to another function without purpose.

### Proposed profile composition

Names are design proposals until the CLI/SDK task establishes the public contract.

| Profile | Main contents |
| --- | --- |
| existing `documents` | Keep the already qualified baseline stable |
| spreadsheets | openpyxl, XlsxWriter, pandas/numpy, xlrd, pyxlsb, odfpy |
| word | python-docx/lxml, docxtpl/Jinja2, docxcompose, mammoth |
| presentations | python-pptx and its chart/image dependencies |
| pdf-core | pypdf, fpdf2, reportlab, crypto and font dependencies |
| pdf-extract | pdfminer.six, pdfplumber and real PDFium dependency |
| pdf-render | pypdfium2/PDFium, pdf2image/Poppler; PyMuPDF separately selected where appropriate |
| pdf-ocr | pytesseract/Tesseract, language packs, OCRmyPDF and full native closure |
| document-conversion | Selected MarkItDown extras, Magika/ONNX model, semantic converters |
| plotting | numpy, matplotlib, Pillow, fonts, shaping and SVG conversion dependencies |
| full collection | Union of required qualified profiles, explicitly selected |

Installation consent/transport and runtime trust are inherited from the foundation.
No default network service, unrestricted guest networking, auto-install from import
strings, hidden font lookup or all-extras download is introduced.

## Acceptance matrix

Every case is run through the public Python command over canonical storage, with
an independent assertion appropriate to the requested operation.

| Family | Required representative workflows | Independent checks |
| --- | --- | --- |
| Spreadsheets | Create/edit/style/chart; pandas import/export; legacy inputs; template/macro preservation; recalc | Reopen values/formulas/caches, inspect ZIP parts, input-mutation calculation controls, rendered sheets |
| Word | Author/template/merge; tables/images; comments/redlines; headers/fields; render | Reopen content, inspect anchors/relationships/unchanged parts, page images and field-result checks |
| Presentations | Author/edit/template; images/tables/native charts/notes; split/merge and render | Native chart workbook and axes, notes/relationships, opaque part preservation, slide images/native-app cases |
| PDF generation | ReportLab canvas/Platypus and fpdf2 with tables/fonts/images | Independent PDF readers, extracted text, page structure and page images |
| PDF editing | Pages, overlays, metadata, annotations, attachments, encryption, repair, applied redaction | Object/content and visual comparisons, known-password cases, residual-text checks |
| Forms | Parent/kid fields, orphan widgets, duplicate names, appearances, flattening | Values plus independent rendered appearances on all affected pages |
| Extraction | Positional text and tables, crop/rotation, MarkItDown conversions | Original expected table/text/coordinates; no same-library oracle |
| OCR | Scans/mixed pages, languages, rotation/deskew, searchable output | Expected text/boxes, geometry and retained source imagery |
| Runtime | Offline assets, repeated/concurrent jobs, cancellation, delayed files and quota errors | No leaked handles, no late writes, truthful failures, isolated interpreter state |

Small unit tests use original in-memory data and mocks; no downloads, LLM queries
or host file creation. Maintained integration fixtures execute real runtimes and
native engines separately. Manual QA is a Markdown plan, with images/evidence
retained outside delivered artifacts. Screenshots are inspected, not just generated.

## Execution ordering and completion gates

Tasks are deliberately ordered: inventory and package assets; common dependencies;
format libraries; difficult PDF/OCR/conversion closure; JS and layout/calculation
engines; public configuration and skills; full acceptance and capacity verification.
Task prompts carry their own scope, paths, prerequisites and success criteria.
Only configured `implement` and `test` steps are selected. The plan overrides the
repository's default Git teardown so validation/execution does not implicitly
commit unrelated changes or publish work.

Four product milestones provide useful checkpoints without disguising unfinished work:

1. **Extended Python core:** actual spreadsheet/Word/presentation/ReportLab scripts
   work with locked assets and canonical storage.
2. **Complete library graph:** PDFium, PDF extraction/editing, wrappers, OCR and
   MarkItDown work through their real dependencies; every required library accounted for.
3. **Complete document workflows:** rendering, calculation, forms, preservation,
   skills and CLI/SDK integration pass their specific gates.
4. **Qualified distribution:** public runtime/deployment checks, offline assets,
   licensing/provenance, performance measurements and full coverage audit pass.

The largest research/build uncertainties are PDFium binding portability, portable
Office layout/calculation, ONNX/Magika initialization, and adapting subprocess-heavy
OCR tools without breaking isolation. These are explicit engineering work and
completion blockers. No credible duration estimate should be attached before their
build and workflow probes establish feasibility.

## Source and redistribution handling

Upstream skill text/helpers are research references, not vendored implementation.
The inspected Anthropic document directories contain a proprietary LICENSE.txt;
the repository-wide availability of other skills does not establish permission
to redistribute these four. Write original integration code, examples and skills,
and retain source pointers rather than copied prompt/helper collections.

Library licenses are a separate matter from skill licenses. Record them for exact
packages, native components, fonts and model weights. In particular, PyMuPDF's
AGPL/commercial distribution options require an explicit packaging decision, and
Poppler, PDFium, QPDF and OCR/model assets must each be checked independently.
This is dependency/distribution engineering, not a claim of legal review.

Useful primary technical references:

- [Pyodide package loading](https://pyodide.org/en/stable/usage/loading-packages.html): pure and matching Wasm wheels, dependency resolution and integrity.
- [Pyodide Python compatibility](https://pyodide.org/en/stable/usage/wasm-constraints.html): platform/API differences.
- [Exact runtime package index](https://cdn.jsdelivr.net/pyodide/v314.0.6/full/pyodide-lock.json): ABI and native artifact availability used in this research.
- [pypdfium2 Python API](https://pypdfium2.readthedocs.io/en/stable/python_api.html): actual binding surface that a port must support.
- [Anthropic pinned skill source](https://github.com/anthropics/skills/tree/34040c9c568585f6929bedeaad110ad08f079624/skills): workflow/helper provenance, not a runtime qualification result.

## Plan validation

Run `poe-code pipeline validate docs/plans/python-document-libraries.md` after
editing. Confirm every task prompt is self-contained, every included step exists
in `.poe-code/pipeline/steps.yaml`, and all implementation states remain open at
planning delivery. Validation does not run the pipeline or qualify the libraries.
