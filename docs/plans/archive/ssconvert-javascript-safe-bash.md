---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
readiness: draft
setup:
  prompt: Execute tasks in listed order. Read root and relevant scoped AGENTS.md
    and the task prompt. This pipeline implements a JavaScript ssconvert
    compatibility engine for safe-bash against pinned Gnumeric 1.12.61; no
    native product fallback. Preserve unrelated edits and assign owned paths.
    Use failing tests before code and maintained uncached checks. All plans/QA
    procedures belong in docs/plans; temporary evidence belongs in out. Do not
    edit README files without permission. Do not commit, push or publish unless
    separately authorized by the user. Research/source inventory is preparation,
    not verified product parity.
teardown:
  prompt: Report completed tasks and concrete checks, open compatibility
    discrepancies and unavailable oracle/plugin/service evidence. Keep
    implemented versus failed/unmeasured/unsupported coverage separate. Purge
    only task-owned scratch evidence from out after reducing findings. Do not
    claim full ssconvert parity from a subset. Do not automatically commit,
    push, publish, change unrelated edits or add README content; report any
    separately authorized local commit, verified remote main and successful
    release distinctly.
tasks:
  - id: freeze-reference-contract
    title: Freeze the released CLI, plugins and compatibility profile
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Create docs/ssconvert/reference-profile.json and docs/specs/ssconvert.md
      from the official 1.12.61 tarball and a reproducible native reference
      installation in an isolated QA environment. Record binary/source hashes,
      operating system, compile options, GOffice/GLib/GTK/GDK/libgsf/iconv
      versions, solver algorithms, fonts, paper sizes, locale, timezone,
      configuration roots and activated plugin IDs. Capture --version, -h,
      --help, --help-all, --help-libspreadsheet, --help-gtk and any
      GDK/group-qualified aliases actually accepted. Probe --usage rather than
      trusting its manpage mention. Capture format/image listings with separate
      stdout/stderr/status and distinguish listable formats from usable formats.
      Preserve exact usage, descriptions, spelling, spacing and channel routing;
      deployment paths need an explicit virtual reference mapping. Inventory
      every ssconvert main entry including hidden options and inherited options,
      parser conflict precedence, plugin availability and diagnostics. Establish
      a full source-plugin coverage register even for plugins absent in the
      primary binary; create additional reproducible reference profiles for
      optional file-format plugins. Do not silently narrow the requested full
      feature scope to the primary binary. No local ssconvert was found during
      planning, so actual runtime observations are a required gate, not existing
      evidence.


      This is research/specification work: validate every claim against primary
      source or an explicit oracle observation, record source
      locations/provenance and unknowns, and do not change product code. Store
      temporary captures in out and remove owned scratch files after reducing
      the findings.
    status:
      implement: done
  - id: audit-complete-feature-register
    title: Audit all source features, options and upstream test families
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Expand docs/specs/ssconvert.md and docs/ssconvert/coverage.json into an
      exhaustive feature-to-task-to-test register. Audit src/ssconvert.c,
      libgnumeric.c, gutils.c, workbook-view.c, stf.c, stf-export.c,
      stf-parse.c, xml-sax-read/write.c, print-info.c, all file opener/saver
      manifests and implementations, built-in functions, every function-group
      manifest and analysis tool writable property. Include disabled-by-build
      services separately from interactive-only services and arbitrary
      third-party extensions. Census every upstream test and sample relevant to
      imports, exports, round trips, styles, formula conversions, objects,
      statistical accuracy, solver, analysis and ssconvert options; map each to
      an original regression, independent QA case or explicit unresolved
      blocker. Record per-format versions, supported/rejected records, limits,
      loss warnings and source citations. Do not infer whole-format support from
      extension names. Confirm the manual/source discrepancy for text
      formulas=true: the reviewed stable cb_set_export_option whitelist excludes
      formulas. Source review and runtime observation override stale
      documentation. Read primary format specifications and implementation
      behavior; preserve required legal notices if any material is reused rather
      than translating GPL source without a licensing decision.


      This is research/specification work: validate every claim against primary
      source or an explicit oracle observation, record source
      locations/provenance and unknowns, and do not change product code. Store
      temporary captures in out and remove owned scratch files after reducing
      the findings.
    status:
      implement: done
  - id: design-javascript-engine
    title: Specify the workbook engine, codecs and safe-bash integration
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Write docs/ssconvert/architecture.md and the public SDK contract in
      docs/specs/ssconvert.md. Choose packages/ssconvert as the proposed domain
      package and packages/safe-bash/src/commands/ssconvert as the
      virtual-command integration; use a proposed public @poe-code/ssconvert
      workspace name only after collision review. No spreadsheet SDK currently
      exists; packages/office-package provides ZIP/compression primitives, not
      cells or formula calculation. Inspect those APIs before reuse and define
      the workbook SDK needed by Pandoc without changing its separately gated
      XLSX behavior. Evaluate candidate JavaScript libraries against the
      complete codec/calculation/rendering matrix, licensing, bounded I/O,
      formula-cache preservation and legacy formats; SheetJS/ExcelJS alone do
      not establish Gnumeric parity. Prefer zero runtime dependencies inside
      safe-bash; isolate any justified dependency in the domain package, use
      existing parsed XML/ZIP infrastructure when suitable, and do not add a
      native or WASM-compiled Gnumeric/LibreOffice/Python fallback. Declare
      sparse workbook, expression, format, object, print and solver models;
      registry data includes exact Gnumeric IDs, descriptions, probe/default
      priorities, extension/MIME, scope, sheet-selection and option grammar.
      Derive dispatch and listings from declarative descriptors; new format
      providers should require one provider file and no provider-ID if/case
      chains. Separate exact CLI behavior, serialized semantics, rendering
      equivalence and byte determinism. Define resource budgets and capability
      mappings as SDK/host configuration, not new CLI flags.


      This is research/specification work: validate every claim against primary
      source or an explicit oracle observation, record source
      locations/provenance and unknowns, and do not change product code. Store
      temporary captures in out and remove owned scratch files after reducing
      the findings.
    status:
      implement: done
  - id: scaffold-domain-package
    title: Create the domain package and typed capability contracts
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Create packages/ssconvert with inspected workspace build/package
      conventions, TypeScript ESM public exports and small internal modules for
      cli, workbook, formulas, formatting, codecs, rendering and solver. Expose
      a single genuine conversion engine used by both CLI and SDK, typed ordered
      cell updates, repeated exporter options,
      merge/split/graph/range/clipboard/analysis operations, registry and
      runtime limits. Preserve CLI parser quirks separately from a typed SDK
      API. Define explicit filesystem, byte source/sink, env/locale/timezone,
      clock/random, cancellation and owned-cleanup inputs; no ambient host I/O,
      subprocesses or credential reads. Packaging and public export wiring must
      be reviewed by the assigned root integration owner. A package README is
      required by repository rules but additions require explicit user
      permission: prepare its complete usage/config/env draft in
      docs/ssconvert/usage-draft.md and keep README publication recorded as an
      unresolved delivery gate until authorized. Do not invent an empty README
      or claim the package documentation requirement is met by the draft.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: bounded-workbook-model
    title: Implement sparse cells, sheets, names and workbook state
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/workbook with sparse dimensions,
      supported sheet size constraints, ordered sheets, active sheet/view,
      hidden/very-hidden visibility, row/column metadata, merges, typed
      blank/string/number/boolean/error cells, rich text, formulas and
      cached-result presence, shared/array formulas and named expressions with
      workbook/sheet scopes. Preserve dates as serials with source date-system
      metadata, calculation mode, iteration settings, dependency relationships,
      workbook properties and unsupported imported records according to
      reference behavior. Separate content, displayed text and style. Add
      meaningful round-trip and invariant cases for missing versus empty cells,
      named conflicts, arbitrary Unicode names, A1 boundaries, detached sheets
      and metadata transfer. Do not eagerly allocate a full sheet or invent
      unsupported format fields.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: format-provider-registry
    title: Implement declarative format discovery and probe priority
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Build packages/ssconvert/src/codecs registry from one declarative file per
      provider, exposing exact stable opener/saver IDs, descriptions,
      extensions/MIME, format level, overwrite policy, default saver priority,
      probe priority, encoding dependence, save scope, sheet-selection and
      exporter option handlers. Support separate opener/saver entries sharing an
      ID, including Gnumeric_Excel:xlsx and Gnumeric_OpenCalc:openoffice. Match
      native content/name probe precedence, filename extension handling and
      forced -I/-T overrides; an importer is not selected solely from its
      extension. Keep interactive-only Gnumeric_stf:stf_assistant import out of
      native noninteractive listings, while its noninteractive exporter remains
      distinct. Installed availability must be truthful; keep unimplemented
      source providers in the coverage register and block full-parity completion
      rather than fabricating listings. Test competing
      .xls/.xlsx/.ods/.html/.tex/.xml defaults independently of the registry
      under test.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: glib-compatible-cli-parser
    title: Match main CLI grammar and option precedence
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/cli parser matching GLib GOption behavior
      for ssconvert INFILE [OUTFILE] and ssconvert --merge-to OUTFILE INFILE1
      INFILE2 [...]. Cover --version; -v/--verbose; -E/--import-encoding;
      -I/--import-type; --list-importers; -M/--merge-to; -T/--export-type;
      -O/--export-options; --list-exporters; -S/--export-file-per-sheet;
      --export-graphs; --list-image-formats; repeated --set; --recalc; hidden
      --resize, --clipboard, --export-range, repeated --goal-seek, --solve and
      repeated --tool-test. Probe and match short clusters, attached values,
      --key=value versus separate values, --, option placement among operands,
      duplicate scalars/booleans, argument bytes, missing arguments,
      unknown/abbreviated long options and empty values. Preserve action
      precedence: parser errors first; version; explicit split/merge conflict;
      then exporters list, importers list, image list, clipboard, merge, normal
      conversion. Stable main accepts one input with explicit output inference
      and requires at least two merge inputs. Do not add subcommands, --yes,
      prompts, progress spinners, JSON output or convenient aliases absent from
      the oracle.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: inherited-help-and-version
    title: Match help, version and inherited option groups
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement exact help and version output and inherited Gnumeric/GTK/GDK
      option parsing in packages/ssconvert/src/cli. Inventory -L/--lib-dir,
      -D/--data-dir, the libspreadsheet version entry and group-qualified option
      aliases; -v in ssconvert means verbose despite the inherited version
      entry's short-name collision. Probe the actual
      -h/--help/--help-all/--help-libspreadsheet/--help-gtk and GDK help group,
      --usage mention, --display, --screen, --sync, --class, --name,
      --gtk-module, --g-fatal-warnings and build-dependent
      --gtk-debug/--gtk-no-debug. Match usage/errors, hidden-option visibility,
      translated help and --version's three stdout lines with
      version/datadir/libdir. Define virtual configuration roots matching -L/-D
      observable effects without loading native libraries or reading ambient
      directories. Do not silently accept flags as no-ops if they have
      observable reference effects; inherited GUI/debug/module options
      unresolved under the virtual runtime remain named parity blockers, with no
      unsafe host/native fallback. Capture screenshots of help/list/errors
      during eventual CLI QA.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: listing-and-diagnostics
    title: Match listings, diagnostics and exit status
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/cli output behavior. --list-importers and
      --list-exporters sort noninteractive IDs using native byte ordering, align
      ID | Description to maximum ID byte length and write to stderr;
      --list-image-formats follows reference enum order rather than the
      format-ID sort. --version writes stdout. Preserve stderr warnings and
      unconditional merge messages as well as verbose exporter selection. Match
      error wording and status precedence for unknown importer/exporter,
      unable-to-infer exporter (stable status 2), missing output/type, loading
      failures, option syntax/value errors, invalid range/update, unsupported
      sheet subset/split and I/O failures. Avoid a generic error handler that
      converts every failure to one status. Test stdout remains unpolluted for
      fd://1 CSV/binary output and verify subprocess-independent simulated sink
      errors.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: vfs-paths-and-stream-uris
    title: Implement filename, URI and standard-stream behavior
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/io against injected capabilities:
      cwd-relative and absolute VFS paths, file: URI conversion/escaping and
      literal fd://0 input/fd://1 output. Probe whether a literal '-' is a
      filename; do not invent stdin shorthand. Define and implement reference
      handling of other fd://N values with explicit descriptor bindings,
      repeated stream inputs, file authority, encoded names and URI validation.
      Support remote URI schemes only via explicitly authorized host transport
      or registered VFS adapters, authorize every redirect and avoid ambient
      network/credentials; reproduce native failures where the reference has no
      handler. Record capability-disabled URI access as a known safety
      divergence, never an equivalent pass. Preserve byte streams, backpressure
      and cleanup; ZIP/random-access readers may use bounded VFS seek/spool
      rather than pretending all conversions are streaming. Test memory and
      mounted paths, stdin provenance, empty streams and binary output.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: conversion-lifecycle-and-output-inference
    title: Match conversion ordering and output naming
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/conversion control flow in source order:
      resolve image/export mode and output exporter/type/name; resolve forced
      importer; load and apply --set only in ordinary/clipboard paths; configure
      and validate exporter options; merge when requested; goal seeks; solve;
      tool-test; resize; explicit recalc and automatic recalculation;
      export-range and default sheet selection; save/split. Match INFILE alone
      with -T deriving the output extension using reference URI semantics,
      unknown extension status 2 and no-output failures; do not overwrite input
      by a guessed same-format shortcut. Preserve same-file/alias output
      behavior, permissions/errors, format loss warnings, partial-file effects
      and split failures verified against the oracle. Validate with cases
      combining flags so implementation cannot reorder steps for convenience.
      Output atomicity, collision policy and rollback must follow measured
      reference behavior inside authorized VFS capabilities.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: export-options-grammar
    title: Implement GOffice key-value grammar and exporter dispatch
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/cli/export-options parser matching
      go_parse_key_value: Unicode whitespace; quoted or allowed bare keys;
      optional whitespace around mandatory =; quoted escaped values or unquoted
      values ending at whitespace; empty values; repeated ordered key-value
      pairs and first-failure behavior. Match unterminated quote and syntax
      diagnostics, escaping, adjacent pairs and duplicate option behavior rather
      than splitting on spaces or using shell eval/regex. Pass options to each
      selected exporter's own declarative handler, then supported common
      options; generic sheet/active-sheet may work where text-only options do
      not. Plain CSV Gnumeric_stf:stf_csv uses common options, not the
      configurable text whitelist. --export-graphs repurposes -T as an image ID
      and -O accepts resolution only, with native numeric parsing, default 100
      and inclusive bounds 1..10000. Cover invalid resolution strings and values
      without substituting JavaScript's stricter parsing.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: sheet-selection-and-range
    title: Implement sheet, active-sheet and range export semantics
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement common sheet selection and hidden --export-range in
      packages/ssconvert. sheet=NAME and active-sheet=VALUE require = and
      accumulate ordered selections; the active-sheet value is ignored. Match
      unknown names, repeated/duplicate selections, default active sheet versus
      first sheet and workbook/sheet/range save-scope validation. Match
      --export-file-per-sheet rejection for workbook exporters lacking
      sheet-selection and range exporters, subset restrictions and sheet
      exporters requiring exactly one selected sheet. Support quoted
      sheet-qualified A1 ranges, names where accepted, absolute/relative
      references, sheet spans and invalid/trailing text under Gnumeric grammar;
      do not limit --set/range to a simplistic cell regex. Export-range can
      alter the selected sheet and is consumed only by exporters that honor it.
      Probe hidden rows/columns, sparse trailing blanks, merged ranges,
      selection order and interactions with merge (options are processed before
      input workbooks are merged).


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: cell-updates-and-recalc
    title: Implement repeatable --set and calculation triggers
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement --set in packages/ssconvert/src/workbook/updates, preserving
      ordered repeated updates, Gnumeric range grammar, default/qualified sheet
      resolution, empty content, numeric/boolean/date/string inference,
      apostrophe-prefixed literals and formulas introduced by an extra = (e.g.
      --set 'A11==A10+1'). Match multi-cell/range acceptance from apply_updates,
      malformed references and first-error effects. Match normal and clipboard
      update paths; merge does not apply --set to source workbooks in reviewed
      source. Recalculate after updates according to calculation mode, and force
      workbook-wide recalculation only for --recalc at its measured lifecycle
      point. Keep original formula caches when the oracle does, distinguish
      dirty formula/cache states, and test repeated dependent edits, manual
      mode, named references and flag-order independence where native behavior
      is identical.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: expression-parser-and-reference-rewriting
    title: Implement formula syntax and reference conversion
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/formulas parsing and AST for native
      Gnumeric syntax and codec-specific Excel/ODF/SYLK/legacy expression
      conventions. Cover operator precedence, unary and percent, concatenation,
      comparison, intersections/unions/ranges, parentheses, escaped strings,
      scalar/error/array literals, function namespace aliases, omitted
      arguments, A1/R1C1, absolute/relative/mixed/3D/external references and
      named expressions. Rewrite references correctly during sheet
      rename/move/merge/resize and serialize per-format grammar without eval or
      Function. Preserve unknown functions/formulas and formula caches exactly
      as the reference reader/writer allows, and reproduce errors/warnings
      instead of deleting formulas. Capture distinct parse positions for --set
      formulas and shared/array formula translation.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: calculation-core
    title: Implement dependency evaluation and numeric semantics
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/formulas dependency graph/evaluator
      matching Gnumeric coercions, blanks/errors/text/boolean/range/array types,
      implicit intersection, missing arguments, lazy IF branches, floating-point
      edge cases, comparisons, domain errors, circular references,
      iterative-calculation settings, volatility and recalculation order.
      Implement native built-ins from src/func-builtin.c, not just plugin
      manifests, including every descriptor actually registered. Implement
      shared/array formulas and cached error/results. Inject time and random
      sources for repeatable tests, while documenting observable nondeterminism;
      external workbook references use only explicit authorized resolver
      capabilities, never network by formula accident. Numeric tolerances in
      independent QA must be justified per function and cannot mask exact
      text/CSV output differences. Guard dependency depth, visits, iteration and
      cancellation without claiming reference equivalence for host resource
      refusals.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: functions-logical-text-lookup
    title: Implement logical, text, information, database and lookup functions
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement all functions and argument contracts in stable
      plugins/fn-logical, fn-string, fn-info, fn-lookup and fn-database, plus
      the matching built-in special forms in src/func-builtin.c. Enumerate every
      manifest entry into docs/ssconvert/function-coverage.json; audit
      descriptor arity, coercion, flags, aliases, errors, laziness, reference
      returns and import/export renaming. Cover conditional logic,
      text/Unicode/search/formatting, type/error predicates,
      address/reference/index/match/lookup operations and database
      criteria/aggregates. Test every named function with a meaningful normal
      and edge/domain-error case, supported arrays/ranges, locale effects,
      missing/extra arguments and persisted cache/formula behavior. Unsupported
      entries stay blockers, not stub #NAME? successes.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: functions-math-engineering-complex
    title: Implement mathematical, engineering, complex and number theory functions
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement the complete stable plugins/fn-math, fn-eng, fn-complex, fn-flt
      and fn-numtheory function groups in packages/ssconvert, preserving exact
      argument semantics, aliases, integer/bit/conversion behavior, matrix
      operations, rounding, overflow/underflow, special-value/error propagation
      and native formatting. Enumerate every manifest function and source
      descriptor in docs/ssconvert/function-coverage.json, including
      scientific/special functions that need deliberate JavaScript numeric
      algorithms. Use independent high-precision references and upstream
      behavioral evidence in isolated QA, while canonical unit cases remain
      original and fast. Do not substitute JavaScript Math operations without
      checking cancellation, accuracy, extreme inputs and signed zero against
      the pinned oracle.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: functions-date-finance-calendars
    title: Implement dates, finance, derivatives and calendar function groups
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement every stable function in plugins/fn-date, fn-financial,
      fn-derivatives, fn-christian-date and fn-hebrew-date. Cover serial
      date/time arithmetic, day counts, 1900/1904 and Excel leap-year
      conventions, timezone/locale behavior, workdays/holidays,
      bond/coupon/discount/amortization/cashflow functions, root-finding
      IRR/RATE families, financial options/derivatives and specialized
      calendars. Inventory arity, aliases and errors per descriptor in
      docs/ssconvert/function-coverage.json. Inject clocks for volatile date
      functions; match the reference algorithm's admissible inputs, precision
      and convergence/failure behavior. Verify conversion across
      Gnumeric/Excel/ODF preserves both expression and date system rather than
      stringifying dates.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: functions-statistics-random-timeseries
    title: Implement statistics, distributions, random and time series functions
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement every function in stable plugins/fn-stat, fn-r, fn-random,
      fn-tsa and fn-erlang. Cover aggregates, order/rank/percentile,
      correlation/regression, statistical tests, probability density/CDF/inverse
      distributions, numerical stability/tails, random variates,
      Fourier/time-series/interpolation and queueing formulas according to
      actual descriptors. Register all names, aliases, arities and domain errors
      in docs/ssconvert/function-coverage.json; statistical helper routines are
      part of the parity work, not mocked product results. Use reproducible
      injected randomness for units and distribution/seed behavior comparisons
      as separately justified QA. Account for every upstream accuracy case and
      numerical limits; do not call approximate results exact because serialized
      values look plausible.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: number-date-style-formatting
    title: Match GOffice number formats, dates and text representation
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/formatting for GOffice/Excel
      number-format tokens and native display semantics: General, numeric
      precision, exponent notation, grouping, percentages, currency/accounting,
      fractions, scientific notation, date/time and elapsed durations,
      conditional sections/colors, literals/escapes, locale tags and custom
      formats. Match automatic/raw/preserve text modes, error/boolean rendering,
      negative zero, very small/large values, locale-specific separators, date
      epochs and round-trip serial precision. Preserve styles, fonts, fills,
      borders, alignment, rotation, wrapping, indentation, protection,
      themes/palettes and rich text independently of formatting. Reference
      sample: native manual's formatted date distinguishes automatic date text,
      preserve display and raw serial; verify actual bytes against the oracle
      rather than copying the example as proof. Do not use ambient Intl behavior
      as a parity guarantee.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: text-import-csv-tsv
    title: Implement native CSV/TSV probing, decoding and value inference
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_stf:stf_csvtab in packages/ssconvert/src/codecs/text.ts
      from stable stf.c, stf-parse.c and stf-parse detection helpers. Match
      encoding guessing/BOM and -E override, empty-file/name probing,
      CSV/tab/separator heuristics, multiline/doubled-quote parsing, CR/LF/CRLF,
      whitespace, trailing fields/rows, malformed records and per-column
      number/date/boolean/formula inference under locale. Audit configurable
      Gnumeric_stf:stf_assistant import as interactive-only in the standard
      profile; match explicit invocation behavior rather than treating it as an
      ordinary CSV alias. Cover binary-looking inputs, NUL/invalid bytes,
      Unicode, long rows and bounded decoding. Preserve literal text/formula
      interpretation as native does; do not add a security-driven apostrophe
      transformation to the CLI.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: configurable-text-export
    title: Implement configurable text and distinct plain CSV exporters
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_stf:stf_assistant export with exact accepted -O keys
      from stable src/stf-export.c: sheet, active-sheet, eol=unix/mac/windows
      (case handling from source), charset, locale, quote, separator,
      format=automatic/raw/preserve, transliterate-mode=transliterate/escape,
      quoting-mode=never/auto/always and quoting-on-whitespace. Match defaults,
      property enum/boolean parsing, multi-character separators/quotes,
      doubled/escaped quoting, leading/trailing whitespace, embedded newlines,
      ragged/blank ranges and multiple selected sheet concatenation. Implement
      Gnumeric_stf:stf_csv separately from stf_write_csv, with native
      comma/quote/line-end defaults and common selection options only. The
      manpage's formulas=true is excluded by the reviewed configurable text
      whitelist: reproduce measured rejection unless the pinned runtime proves
      otherwise. Do not implement nonexistent --import-options or silently apply
      arbitrary -O keys to all exporters.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: encodings-locales-and-transliteration
    title: Implement encoding, locale and unrepresentable-character parity
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/encoding and locale runtime for
      source-admitted -E and text -O charset/locale values. Audit native iconv
      encoding aliases, BOM defaults, legacy codepages, invalid/truncated byte
      behavior, output transliteration and Unicode codepoint escape behavior.
      JavaScript TextDecoder alone lacks many encoder/transliterator semantics;
      decide a bounded JS table/library strategy with licensing and tested
      coverage, not a host iconv fallback. Drive behavior only from explicit
      injected env/config, honoring LC_ALL/LC_CTYPE/LC_NUMERIC/LC_TIME/LANG
      precedence actually used by the reference; audit TZ and numeric-format
      behavior. Reject missing locale/encoding capability honestly and retain it
      as a parity gap. Compare text bytes and loss warnings, not decoded strings
      only.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: gnumeric-xml-codecs
    title: Implement compressed and uncompressed Gnumeric workbook codecs
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_XmlIO:sax import/export and Gnumeric_XmlIO:sax:0 export
      in packages/ssconvert/src/codecs/gnumeric.ts. Match gzip detection/output
      for .gnumeric versus uncompressed .xml, XML namespaces/version handling,
      encoding, sheet dimensions/order/views, sparse cells, names, formula
      conventions/caches, rich styles/text, merges, objects, calculation and
      solver settings, workbook metadata and print setup. Audit every SAX
      reader/writer element and attribute into coverage, with external entities
      disabled and bounded decompression. Preserve or drop unknown elements only
      as the reference does and emit native warnings. Test deterministic data
      serialization independently of gzip timestamps/header differences and
      implement byte determinism where the pinned reference test family requires
      it. Use the uncompressed variant to inspect round-trip semantic loss
      without reducing its surface to CSV cells.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: xlsx-read
    title: Implement OOXML XLSX and template import
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_Excel:xlsx importer in
      packages/ssconvert/src/codecs/xlsx.ts using inspected office-package
      ZIP/compression capabilities. Audit every stable plugins/excel/xlsx-read
      source handler and supported namespace/version: workbook/sheets/shared
      strings/styles/date systems/formulas/shared/array
      formulas/caches/names/links, rich text, dimensions, merges, rows/columns,
      comments/hyperlinks, filters/tables, validations/conditional formatting,
      drawings/images/charts, themes, print/page settings, pivot/extension
      behavior and macros/protection/encryption accepted or rejected by native.
      Cover .xlsx/.xltx MIME/probe rules and other extensions only when
      supported by evidence; no assumed XLSB reader. Resolve relationships under
      bounded OPC rules, reject traversal/entity/zip bombs and preserve byte
      ownership. Audit unknown-part handling and warnings according to
      reference, rather than promising lossless Excel editing.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: xlsx-write
    title: Implement both OOXML writer profiles
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement exporters Gnumeric_Excel:xlsx and Gnumeric_Excel:xlsx2 in
      packages/ssconvert/src/codecs/xlsx.ts. They are separate stable IDs:
      ECMA-376 first edition versus ISO/IEC 29500:2008/ECMA-376 second edition,
      not aliases. Audit writer handlers for formulas/caches, number/styles/date
      systems, names, strings, merges/dimensions, drawings/charts/images,
      comments, tables/filters, validations/conditional formats, links,
      workbook/print properties and extension/loss-warning behavior. Match
      default exporter resolution for .xlsx from registry priority and native
      ordering, supported sheet selection and writer row/column limits.
      Differentially inspect OPC parts plus reopen with native and an
      independent reader. Match semantic serialized output and separately
      investigate deterministic ZIP/XML bytes; do not normalize away missing
      formulas, caches, order or relationships.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: xls-biff-read
    title: Implement Excel BIFF and encoding-dependent import
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_Excel:excel and Gnumeric_Excel:excel_enc import in
      packages/ssconvert/src/codecs/biff.ts plus bounded CFB/OLE binary
      primitives. Inventory every supported BIFF revision and record/opcode from
      stable ms-excel-read code; cover workbook/worksheet streams, codepage -E
      path, strings/CONTINUE records, formulas/token translation/caches,
      XF/style/palette/number/date formats, names/external references,
      merges/dimensions/print settings, comments, drawing/chart records,
      encrypted/protected/corrupt handling and loss warnings. excel_enc is a
      distinct priority-200 nonprobe encoding-dependent importer, not an alias
      removed from listings. Bounds-check all offsets/record lengths and CFB
      chain cycles. Tiny original byte fixtures and native round-trip QA must
      expose real parsing failures; a generic dependency claiming .xls support
      is insufficient.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: xls-biff-write
    title: Implement BIFF7, BIFF8 and dual-stream Excel writers
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_Excel:excel_biff7, Gnumeric_Excel:excel_biff8 and
      Gnumeric_Excel:excel_dsf in packages/ssconvert/src/codecs/biff.ts. Match
      stable .xls default priority, BIFF version-specific limits/encodings,
      dual-stream DSF layout, formula tokens/caches/arrays/shared formulas,
      strings, XF/style/palette, date systems, names/links, merges, comments,
      objects/charts and print/workbook records as supported by native.
      Reproduce truncation/loss warnings, unsupported-function translations and
      save failures. Verify CFB integrity, both DSF streams, native reopening
      and independent reader interoperability, not just valid magic bytes. Do
      not implement all three IDs by writing one BIFF8 file.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: excel-spreadsheetml-read
    title: Implement Excel 2003 SpreadsheetML import
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_Excel:excel_xml importer in
      packages/ssconvert/src/codecs/spreadsheetml.ts from stable
      plugins/excel/excel-xml-read.c and its test corpus. Cover
      namespace/content detection, worksheets, sparse Index cells/rows, types,
      dates, styles/inheritance/number formats, R1C1 formulas and caches, names,
      merges, links/comments, row/column sizes and supported workbook/print
      properties. Resolve .xml ambiguity by probe rules versus native Gnumeric
      XML rather than extension-only dispatch. Respect reference
      warnings/unsupported features and malformed XML behavior; do not add an
      Excel 2003 exporter absent from the registry.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: ods-sxc-read
    title: Implement OpenDocument and legacy OpenOffice Calc import
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_OpenCalc:openoffice importer in
      packages/ssconvert/src/codecs/odf.ts for supported .ods/.sxc and template
      MIME variants. Audit stable openoffice reader handlers, ZIP
      manifest/relationships, namespaces/version detection, repeated rows/cells,
      typed/date/duration values, formulas/names and cross-sheet references,
      automatic/named styles, row/column metadata, merges,
      validation/conditional formats, annotations/links, drawings/charts/images,
      filters/database ranges, print settings and unknown-extension warnings.
      Expand repeated ranges sparsely under limits. Cover OpenFormula versus
      legacy formula conventions and cache rules, not merely table extraction.
      Never fetch external links implicitly.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: ods-strict-and-extended-write
    title: Implement strict and extended ODF writers
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement distinct Gnumeric_OpenCalc:openoffice (ODF 1.2 strict) and
      Gnumeric_OpenCalc:odf (ODF 1.2 extended) exporters in
      packages/ssconvert/src/codecs/odf.ts. Audit native namespaces/foreign
      elements, formula translation, repeated/sparse cells,
      styles/names/date/boolean/errors, caches, merges, validations/conditional
      styles, comments/links, chart/image objects, workbook and print settings.
      Match .ods automatic saver resolution from measured profile and
      support/warnings per saver; do not alias extended to strict or invent CLI
      options. Validate ZIP/manifest content, native and independent reopen, and
      original style/formula/object round trips with per-feature loss
      accounting.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: html-import
    title: Implement HTML spreadsheet/table import
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_html:html importer in
      packages/ssconvert/src/codecs/html.ts, matching stable libxml HTML
      parsing/probe behavior for HTML tables, nested tables, multiple
      tables/sheets, row/col spans and merges, entities/encoding,
      whitespace/line breaks, numeric/text inference and supported CSS/Excel
      metadata, hyperlinks and images. Audit malformed markup recovery,
      active-content handling and warning behavior; never execute scripts or
      fetch external resources. Preserve actual native sheet naming and table
      extraction order. The library parser choice must match measured tolerant
      behavior, not assume an XML parser handles all HTML.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: html-xhtml-export
    title: Implement every HTML and XHTML exporter
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_html:html32, html40, html40frag, xhtml and xhtml_range
      in packages/ssconvert/src/codecs/html.ts. Match document/fragment
      wrappers, doctypes/namespaces, escaping, style/font/color/alignment,
      displayed numbers/formulas, blank cells, merges, row/column visibility,
      multi-sheet selection and range boundaries, hyperlinks/images and native
      comments/output ordering. xhtml_range has range save scope and differs
      from full-document XHTML. Match default .html saver selection and split
      validation via metadata. Compare deterministic text bytes; independent DOM
      checks supplement rather than replace CLI byte parity.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: latex-roff-glossary-export
    title: Implement LaTeX, TROFF and glossary exporters
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_html:latex, latex_table and latex_table_visible,
      Gnumeric_html:roff and Gnumeric_GnomeGlossary:po in declarative codec
      providers. Cover exact wrappers/table fragments/visible-row filtering,
      escaping reserved characters, cell alignment/styles/merges, displayed
      values, sheet scope/selection, native comments and newline/tab
      conventions. Match roff .me macros and PO glossary entry
      construction/encoding, not generic plain-text tables. Audit stable export
      implementations and golden-test original fixtures byte-for-byte, including
      empty ranges, hidden rows/columns, Unicode and formula errors. Do not
      assume every exporter honors range/sheet controls uniformly.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: dif-sylk-codecs
    title: Implement DIF and SYLK read/write
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_dif:dif and Gnumeric_sylk:sylk opener/saver providers
      in packages/ssconvert. Audit all accepted record types, coordinate limits,
      quoted strings and escaping, numbers/booleans/errors, sparse/blank
      dimensions and trailer behavior; SYLK additionally needs supported styles,
      formula tokens/names and reference handling. Match sheet save scopes,
      import probing/manual selection, charset/codepage rules, warnings and
      malformed-record behavior. Ensure SYLK imports are not CSV fallback when
      content begins ID. Use original small in-memory record fixtures and native
      cross-format round trips.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: legacy-text-importers
    title: Implement Applix, GNU Oleo and SC/xspread import
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement distinct Gnumeric_applix:applix, Gnumeric_oleo:oleo and
      Gnumeric_sc:sc providers with exact native probe/priority and supported
      syntax. Audit stable record parsers for cells, sheets/dimensions,
      strings/escaping, formulas and reference conventions,
      style/date/row/column/metadata behavior and warnings. SC/xspread source
      text is workbook data, never a shell script or eval input. Translate every
      supported expression construct into the workbook AST and preserve
      cache/error behavior rather than ignoring expressions. Include unsupported
      command/record handling and bounded parsing. No writers for these IDs
      unless the frozen registry actually supplies one.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: legacy-binary-importers
    title: Implement Lotus, Quattro Pro, PlanPerfect and Psion import
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement separate Gnumeric_lotus:lotus, Gnumeric_QPro:qpro,
      Gnumeric_plan_perfect:pln and Gnumeric_psiconv:psiconv providers. Audit
      stable Lotus WK1/WKS/123 and Quattro WB1/WB2/WB3 variants, supported
      PlanPerfect structures and Psion Sheet records/psiconv semantics. Cover
      every supported record/opcode, dimensions/sheets, formulas/cache
      translation, text encodings/styles/date systems, truncation/corruption and
      native warnings. Psion is optionally compiled through a native dependency
      in Gnumeric: implement its format parser in JavaScript or a qualified
      JavaScript codec, never require native psiconv in the product. Create
      optional-profile native oracle cases for absent plugins and account for
      unknown variants explicitly. No invented writers or extension-only
      parsers.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: database-file-codecs
    title: Implement xBase and Paradox table interoperability
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_xbase:xbase importer and Gnumeric_paradox:paradox
      importer/exporter as declarative providers. Audit DBF versions/field
      types, memo dependencies, deletion flags, header/record lengths,
      codepages/date/logical/numeric conversion and Paradox
      database/primary-index .db/.px parsing, blocks, field naming/type mapping,
      precision, associated files and workbook/save behavior. Match supported
      DBF import-only versus Paradox read/write exactly; writing CSV with .db is
      not support. Native Paradox depends on optional pxlib; the product needs a
      JS implementation, with dedicated optional-profile QA. Preserve reference
      diagnostics and warning/partial-output semantics for unsupported fields,
      dimensions, encoding loss and corrupted/missing companion files.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: mps-and-linear-program-export
    title: Implement MPS import and GLPK/LPSolve model export
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_mps:mps import and exporters Gnumeric_glpk:glpk
      (.cplex) and Gnumeric_lpsolve:lpsolve (.lp) from stable provider
      algorithms. Cover fixed/free MPS variants actually accepted,
      rows/columns/objective, bounds, constraints, integer markers and native
      conversion to workbook cells/names/formulas/solver metadata. Export the
      active-sheet solver model with reference objective direction, variable
      naming/order, bounds and integer/binary/constraint formatting and
      supported polynomial/linear detection. Model-file export is separate from
      --solve and must work without spawning glpsol/lpsolve. Match errors for no
      valid model/nonlinear expressions/invalid variable sets and exact text
      output; do not confuse mathematical solver success with exporter parity.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: merge-workbooks
    title: Implement workbook merge semantics and collision behavior
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement -M/--merge-to in packages/ssconvert/src/workbook/merge.ts,
      requiring at least two inputs under stable main and applying forced
      importer/encoding to each. Match input/sheet order, largest
      native-supported dimensions with size suggestion, workbook-scoped name
      migration/conflict abort, sheet-scoped names, free sheet naming,
      workbook/formula link repair, dependency revival and object/chart
      ownership transfer. Preserve unconditional 'Adding sheets from URI' stderr
      messages, errors and output effects. --set is not applied to merge inputs
      in reviewed source; exporter options are parsed/validated on the initially
      empty destination before merge, so sheet options require dedicated
      negative probes. Preserve explicit -S/-M incompatibility timing and
      separately probe --export-graphs with merge because graph mode sets split
      after that check. Avoid generic collision auto-renaming for
      workbook-scoped names.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: split-and-template-expansion
    title: Implement per-sheet output and native filename templates
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement -S/--export-file-per-sheet and shared graph templates in
      packages/ssconvert/src/conversion/split.ts. Match selection order,
      workbook versus sheet/range eligibility, temporary focus/reordering
      semantics without mutating caller workbook state incorrectly, and first
      save failure/previous file effects. Source numbering is zero-based; use %n
      for the emitted file/object index, %s for sheet name, %o for object name
      and %% for literal percent. If the original template has no percent
      anywhere, append .%n after the entire output filename; do not insert
      numbering before its extension. Match source behavior for unknown
      substitutions and trailing %, and output collisions/repeated selected
      sheets, Unicode/path-like sheet/object names and URI escaping through
      authorized VFS paths. Do not sanitize names silently if that changes
      filenames; respect capability bounds and record any refused unsafe mapping
      as a divergence.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: resize-workbooks
    title: Implement hidden sheet resize and reference quirks
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement hidden --resize=ROWSxCOLS in
      packages/ssconvert/src/workbook/resize.ts matching stable sscanf parse
      acceptance (including trailing text behavior), row-before-column syntax,
      suggested/admissible sheet sizes, iteration over sheets, verbose messages,
      resize warnings and actual status effects. Match expand/shrink
      content/style/name/formula/object/print range transformations and
      out-of-bounds data loss. Invalid values may be silently ignored or warn
      rather than universally fail; pin actual behavior before deciding. Use
      t9001-ssconvert-resize.pl as behavioral coverage guidance, with original
      in-memory cases. Never allocate dense dimensions and ensure
      cancellation/limits do not masquerade as reference resize success.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: chart-and-object-model
    title: Implement charts, drawings, images and object preservation
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/objects shared model based on stable
      sheet-object types and codec handlers: chart plots/axes/series/data links,
      titles/labels/legends, colors/fills/lines/fonts/styles, anchor geometry/z
      order and object names, embedded images/shapes/text/comments and supported
      control/widget metadata. Enumerate every chart/plot plugin and source
      object type that affects import/export/printing, including optional
      GOffice extensions; map preserve/render/drop/reject behavior by codec.
      Native --export-graphs exports graph objects only, not all images or all
      sheet objects. Maintain chart source references through
      updates/recalc/merge/resize. Preserve opaque payloads only where the
      reference does and never execute macros, embedded scripts or external
      objects. Establish original object round-trip fixtures and renderable
      layout primitives.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: chart-rendering
    title: Implement JavaScript chart geometry and layout parity
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/rendering/chart using the actual pinned
      GOffice plot/style/text algorithms as behavioral specification. Inventory
      graph types, axes/scales/date/logarithmic/category handling, missing/error
      data, series styles,
      markers/lines/areas/bars/pies/radar/bubble/surface/contours/financial
      plots as actually installed, chart labels/legends/grids/trendlines/error
      bars and native layout/font metric behavior. Port behavior through
      original JavaScript algorithms; do not call a native renderer or claim a
      generic plotting library matches. Font/locale/profile choices are explicit
      host configuration. Test geometry/layout independent of output codec,
      inspect exported screenshots/images in QA and account for every native
      plot plugin, including unsupported or nonrenderable objects as open
      blockers.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: graph-image-exports
    title: Implement --export-graphs and every reference image target
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement --export-graphs, --list-image-formats and image codecs in
      packages/ssconvert/src/rendering/images. The reviewed GOffice enum lists
      svg, png, jpeg, pdf, ps, emf, wmf and eps; pin the actual GOffice version
      and distinguish listed versus graph-renderable formats. -T is an image ID
      in graph mode; auto infers extension (jpg maps to jpeg where source
      specifies) and falls back to svg. Match graph-only filtering, anchor-sort
      comparator/tie order, global zero-based object indices, sheet traversal,
      %o naming, resolution= numeric grammar/default 100/range 1..10000, absent
      graphs and per-object error continuation followed by sheet/split failure.
      Produce real JavaScript SVG/PNG/JPEG/PDF/PostScript/EPS/metafile behavior
      or match native unsupported-target failure; never advertise a renderer
      that emits a placeholder or different image type. Check image
      dimensions/geometry/text and pixel fidelity with profile-specific
      evidence, keeping exact stderr/status/path effects as separate gates.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: print-layout
    title: Implement spreadsheet pagination and print settings
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/rendering/print matching native print
      workbook paths: sheet/row/column selection, hidden items, formatted cell
      text, wrapping/rotation/font metrics, row/column sizing, merges,
      borders/fills, objects, gridlines/headings, print areas/repeated titles,
      page breaks, margins, orientations, scale/fit, page order, centering,
      paper catalog/custom sizes, headers/footers and page numbering. Enumerate
      native source setting fields and per-codec preservation. Use explicit font
      data/metrics and locale/time metadata; respect licensing and runtime
      budget constraints. Test layout scenes in memory and execute Markdown QA
      with screenshot/image inspection against the pinned renderer. Cell
      extraction alone is not PDF feature parity.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: pdf-export-options
    title: Implement PDF workbook and object export
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement Gnumeric_pdf:pdf_assistant in
      packages/ssconvert/src/codecs/pdf.ts, connected to the
      workbook/print/chart scene engine and inspected existing packages/pdf
      public writer capabilities where useful. Match -O sheet/active-sheet,
      object and paper keys, repeated object/name lookup behavior from
      print-info.c, object-over-sheet precedence, paper=fit graph special case
      and named-paper validation. The manpage describes first-object behavior;
      the source collects matching objects, so verify actual repeated-object
      output rather than assuming the prose is complete. Match full workbook
      pagination, chosen sheets, embedded fonts/images, object graph dimensions,
      errors/warnings and output status. Compare PDF rendered
      pages/content/geometry and independently audit deterministic/native
      metadata bytes; normalize only proven nondeterministic fields, never
      pagination, lost text or unsupported objects.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: clipboard-export
    title: Implement hidden clipboard MIME serialization
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement hidden --clipboard with --export-range in
      packages/ssconvert/src/conversion/clipboard.ts. Stable main requires two
      operands plus a range; clipboard path auto-imports, applies --set and uses
      import encoding, while many ordinary conversion flags are not used in that
      path. Audit gui_clipboard_test and every supported clipboard target/MIME
      serializer, including native cells, text/HTML/table/rich/object targets
      actually accepted. Serialize bytes to the supplied output URI without
      accessing the host desktop clipboard. Match range focus, formula/style
      relative-reference handling, invalid MIME/range/load and output failure
      diagnostics/status. A fake text clipboard or a requirement for a GUI
      display is not feature parity; record exact native unsupported-target
      behavior.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: goal-seek
    title: Implement repeated hidden goal seek
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement repeated --goal-seek in
      packages/ssconvert/src/solver/goal-seek.ts from stable range setup and
      dialog_goal_seek's test-mode contract. Research the actual range layout
      used by test/t7100-goal-seek.pl and dialog-goal-seek.c,
      target/result/input and optional bound cells, active-sheet behavior,
      repeat ordering, numeric parsing, convergence, invalid inputs and
      diagnostics. Do not invent a new CLI target syntax. Match dependency
      recalculation, changed input values, report/result cells,
      iteration/precision/failure behavior and subsequent
      solve/tool/resize/export stages. Use original small deterministic
      expression cases and independent difficult-root QA without adding slow
      unit loops.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: solver-model-and-validation
    title: Implement solver models, options and validation
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/solver typed parameters loaded from
      native Gnumeric/Excel/ODF representations: objective/target, variable
      cells, constraint relations, integer/binary domains,
      linear/quadratic/nonlinear classification and source-supported
      algorithms/options. Match validation, objective references, name/formula
      interactions and active-sheet selection. Audit run_solver's fallback
      algorithm selection by model type, iteration/time limits and validation
      diagnostics. Optional GLPK/LPSolve/native solver dependencies exist in the
      oracle but are forbidden product fallbacks. Registry availability must be
      explicit and deterministic; missing JS algorithms remain parity blockers
      rather than accepted no-op --solve behavior.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: javascript-optimizer
    title: Implement --solve algorithms and solver reports in JavaScript
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/ssconvert/src/solver algorithms for every
      model/algorithm exposed by the agreed full reference profiles: linear
      programming, mixed integer, quadratic/nonlinear and optional native plugin
      variants after auditing Gnumeric_glpk, Gnumeric_lpsolve and
      Gnumeric_nlsolve source. Match objective/constraints/result application,
      algorithm choice, status, convergence/tolerances/limits and report sheet
      generation. Native run_solver can print Solver errors or limit warnings
      and continue conversion; preserve actual command success/failure behavior
      instead of forcing all optimization errors to nonzero. Use cancellable
      bounded JS numerical routines and qualified JavaScript dependencies only;
      no subprocess/native/WASM optimizer fallback to avoid writing the feature.
      Verify optimal values/feasibility, changed cells and report
      formulas/styles, including unsatisfiable, unbounded, degenerate and limit
      cases.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: analysis-tool-protocol
    title: Implement hidden --tool-test argument and property semantics
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement --tool-test protocol in packages/ssconvert/src/analysis. First
      repeated value is the tool name; remaining repeated values are key:value
      arguments, split at the first colon. Match ignored malformed-argument
      warnings, duplicate replacement, sheet/data/x/y/formulas special handling,
      Boolean yes/y/true/1 acceptance, canonical hyphenated property names, C
      atoi/atof conversion quirks and enum nick/numeric parsing from
      run_tool_test and parse_property_based_options. Inventory every writable
      property/default/enum/constraint in the native analysis tool classes.
      Match output to a newly generated sheet, put-formulas default true,
      unknown tool and analysis failure diagnostics/status, ignored/unconsumed
      options and exact sheet names. Do not add public analysis subcommands or
      change the accepted undocumented CLI grammar.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: analysis-regression-anova-moments
    title: Implement regression, ANOVA, covariance and descriptive analysis
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement hidden --tool-test tools regression, anova, anova2,
      descriptive-statistics, correlation, covariance and principal-components
      in packages/ssconvert/src/analysis. Audit all writable tool-specific
      properties and defaults, generic data versus explicit x/y ranges,
      grouping/labels/missing values, confidence/alpha/detailed-statistics
      switches and output formatting. Match generated sheet names, cell labels,
      layout, formulas versus calculated values, linked data, styles and
      statistical numerical results. Test actual command execution with repeated
      --tool-test values, not direct helper calls alone. Map stable test/t7200,
      t7201, t7203, t7204 and t7212 families and source handlers to original
      in-memory cases and independent numeric QA.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: analysis-time-series-distributions
    title: Implement time series, frequency, ranking and transform analysis
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement hidden --tool-test tools moving-average, exponential-smoothing,
      histogram, frequency-tables, fourier-analysis, sampling, ranking,
      normality-test and auto-expression in packages/ssconvert/src/analysis.
      Enumerate source writable properties/defaults, range conventions,
      grouping/labels/binning/smoothing/sampling modes and output
      sheet/formula/style layout. Sampling must use injected reproducible random
      for unit cases and measured stochastic behavior for oracle QA. Match
      generated formulas and reference updates, not only numeric tables; verify
      flags/properties actually accepted and domain/invalid-data errors. Audit
      every applicable t720x/t721x native analysis test and source class into
      coverage.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: analysis-statistical-tests-and-utilities
    title: Implement all statistical test and analysis utility tools
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement hidden --tool-test tools chi-squared-test, sign-test,
      sign-test-two-samples, one-mean-test, wilcoxon-signed-rank-test,
      wilcoxon-signed-rank-test-two-samples, wilcoxon-mann-whitney, f-test,
      t-test-paired, t-test-equal-variances, t-test-unequal-variances,
      kaplan-meier, z-test, advanced-filter and fill-series, using exactly these
      stable run_tool_test names. Audit source-specific properties,
      paired/equal/unequal variance behavior, survival/censoring/grouping for
      Kaplan-Meier, numeric and date-series modes, criteria ranges, data
      grouping/labels, generated sheets/formulas/styles and warning/failure
      paths. Consolidate all actually accepted test tools with no omissions and
      mark consolidate, random-generator and random-generator-cor as explicitly
      unsupported by run_tool_test, even if present in the GUI. Do not equate
      GUI analysis features with ssconvert command features.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: optional-runtime-extension-profiles
    title: Account for optional function loaders and custom plugin effects
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Audit stable optional GDA/GNOME-DB, Excel plugin functions, Guile,
      Perl/Python function modules and loaders, sample data-source and
      third-party GOffice/native extension points. Define finite reproducible
      optional profiles in docs/ssconvert/reference-profile.json and coverage:
      distinguish workbook format services, callable formula functions,
      data-source/environment behavior and GUI-only plugins that do not affect
      ssconvert. Implement source-shipped command-observable services through
      original JavaScript providers, including any compatibility interpreter
      needed for source-shipped interpreted functions; do not load arbitrary
      native modules or introduce Python/Perl/Guile subprocesses. Arbitrary
      external plugins cannot have a finite predeclared feature list: define an
      explicit trusted JS provider extension contract and document extensions
      that need a port. Keep every relevant source-shipped optional capability
      unresolved until it has implementation/oracle coverage; do not silently
      exclude it to claim full parity.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: safe-bash-plugin
    title: Register the exact ssconvert command with safe-bash
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement packages/safe-bash/src/commands/ssconvert/index.ts using
      inspected CommandDefinition, VirtualShellPlugin, getCommandArguments and
      existing engine integration contracts. Register only the literal ssconvert
      name with collision preflight and explicit replacement policy, forward
      owned raw argument bytes, cwd, filesystem, stdin/default-origin,
      stdout/stderr, exported env, AbortSignal and synchronous cleanup
      registration to the actual JavaScript domain engine. Keep all conversion
      logic in packages/ssconvert and avoid empty proxy-function layers. Decide
      explicit plugin versus default aggregate registration after measured
      startup/dependency review; the command must be available in the intended
      safe-bash agent environment without new invocation syntax. If default
      registration changes, synchronize maintained independent command
      inventories and integration-input exact path registrations; preserve
      historical seals. Root integration owner handles package
      exports/SDK/browser opt-ins and does not bypass guarded build/lint paths.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: portable-sdk-and-pandoc-contract
    title: Verify public SDK parity and reusable workbook APIs
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Expose and test packages/ssconvert public APIs for every CLI operation and
      configuration: import/export IDs and ordered exporter options, encoding,
      conversion, merge, sheet selection/split templates, graph
      export/resolution, cell/range updates, calculation/resize, clipboard, goal
      seek, solver, analysis, registry/help metadata and explicit runtime
      capabilities. SDK does not have to emulate malformed argv, but must expose
      equivalent genuine operations and environment controls. Use
      published-style compiled consumer imports with strict NodeNext
      declarations, browser-compatible pure JS codec paths and no private-path
      imports or implicit Node-only host I/O in the engine. Provide actual
      bounded XLSX reader/workbook exports reusable by Pandoc; updating Pandoc's
      separately blocked gate is not authorized automatically in this
      implementation task. Capture full CLI-to-SDK feature mapping and prevent
      SDK-only functionality gaps.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: resource-budgets-and-cleanup
    title: Enforce bounded parsing, computation and owned cleanup
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Implement and adversarially verify limits across packages/ssconvert and
      safe-bash integration: argument bytes,
      input/compressed/inflated/retained/output bytes, ZIP entries/ratios, XML
      nesting/text/entities, binary offsets/chains/records, sparse
      cells/styles/names/objects, formula depth/evaluation/range expansion,
      numerical iterations, raster pixels/fonts and split output count. Admit
      before allocation/decompression, preserve Uint8Array
      ownership/backpressure, propagate cancellation into provider
      reads/writes/render/solver and register cooperative cleanup before owned
      acquisition. Use supplied FileSystem readBytes/writeBytes and signals,
      safe VFS temp/exclusive creation if actually required, and preserve parent
      environment/resources. Capability denial and budget refusal are explicit
      host divergences; diagnostics must not pretend they are native format
      errors. Test reused producer chunks, early sink failure, abort at every
      phase and cleanup settlement; limits are SDK configuration rather than new
      user CLI flags.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: canonical-differential-corpus
    title: Create complete command and workbook parity gates
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Create original fast memfs canonical tests plus explicit native-oracle QA
      tooling/captures isolated from default unit discovery. Define a feature
      register with denominators and immutable source/profile/input hashes;
      capture argv bytes, stdin, env/profile, stdout/stderr/status and
      before/after filesystem namespaces. Cover every main/hidden/inherited
      option, accepted parser form/error/action precedence, all noninteractive
      importer/exporter IDs, both OOXML/ODF/BIFF profiles, all function entries,
      print/chart targets, solver and analysis properties. Compare deterministic
      CLI/text/file bytes exactly. Structured output needs a separate semantic
      comparison and reproducible round-trip/interoperability gates, while
      nondeterministic fields are only normalized with evidence and remain
      separately accounted. Do not drop warnings, missing
      caches/formulas/styles, order or namespace effects in normalization.
      Missing native dependencies/oracles are blocked cases, never skips
      reported as passes. Run source-relevant upstream test cases as research
      guidance without copying licensed code/assets into original unit fixtures.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: real-adapter-and-shell-workflows
    title: Verify shell pipelines and real filesystem adapter workflows
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Write and execute a Markdown QA procedure in
      docs/plans/ssconvert-safe-bash-qa.md for the real safe-bash command, both
      direct argv and VFS .sh scripts. Verify native-shaped examples: ssconvert
      input.xlsx output.csv; ssconvert -T Gnumeric_stf:stf_csv input.ods fd://1;
      cat input.csv | ssconvert -I Gnumeric_stf:stf_csvtab -T
      Gnumeric_Excel:xlsx fd://0 output.xlsx; --set 'A11==A10+1' --recalc; -S
      'out-%n-%s.csv'; -M combined.ods one.xlsx two.xlsx; --export-graphs -T png
      input.gnumeric 'chart-%n.png'; supported -O sheet= and configured text
      options. Verify shell quoting/expansion, stream byte preservation,
      PIPESTATUS/exit status, errors, duplicate registration and SDK-equivalent
      effects. Exercise memory plus configured real-root, mounted S3/WebDAV
      where authorized, including failed writes/cancellation; service
      unavailability must remain unverified. QA is an agent-executed Markdown
      plan, not a TS QA script. Native reference processes remain outside the
      virtual product shell.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: visual-compatibility-qa
    title: Inspect CLI screenshots, printed pages and chart exports
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Write/execute the visual portions of docs/plans/ssconvert-safe-bash-qa.md.
      Use npm run screenshot-poe-code -- <inspected command> for user-visible
      poe-code routes that expose ssconvert help/list/errors, and an appropriate
      terminal capture for actual safe-bash invocations when no direct poe-code
      forwarding route exists; do not invent a root poe-code ssconvert
      subcommand. Inspect images with view_image, checking CLI
      spacing/channels/messages, graph/image sizes, fonts/axes/labels and PDF
      pagination/print settings against pinned native outputs. Render/reference
      image tools are explicitly isolated QA capabilities. Store temporary
      evidence in out, reduce durable conclusions into docs/ssconvert, and purge
      owned scratch images afterward. Do not add screenshot tests. Do not add
      spinners/styling to ssconvert byte output or directly use chalk/@clack,
      since upstream CLI compatibility governs this command.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
  - id: final-coverage-and-delivery
    title: Audit complete feature parity and document delivery gates
    prompt: >-
      Target a JavaScript implementation named exactly ssconvert, authored as
      TypeScript ESM in packages/ssconvert and exposed as a virtual command in
      packages/safe-bash. Match released Gnumeric 1.12.61, official source
      archive SHA-256
      2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12, with a
      captured reference dependency/plugin/locale profile. Acquire primary
      source only into out; native ssconvert is an explicitly separate QA
      oracle, never a product dependency or fallback. Preserve existing edits,
      follow root and scoped AGENTS.md, keep plans/QA procedures in docs/plans,
      and do not edit README files without user permission. Do not push or
      publish.


      Audit docs/specs/ssconvert.md, docs/ssconvert/coverage.json,
      function-coverage.json and actual compiled product/consumer tests for
      every source-shipped CLI-observable feature of stable 1.12.61 and all
      named optional profiles. Report implemented/failed/unmeasured/unsupported
      totals separately by CLI/parser, formats/versions/records, workbook
      objects/styles, functions/numerics, graphics/printing,
      optimization/analysis, capabilities and service adapters. Each source
      feature needs a concrete test/evidence or an open blocker; no full-parity
      claim from a passing subset or mock/native fallback. Verify maintained
      uncached npm run build, scoped workspace tests and appropriate
      repository-wide npm test/lint for this cross-workspace integration;
      respect guarded safe-bash routes and use npm run lint:workflows if
      workflows changed, without workflow unit tests. Finish usage/config/env
      docs in docs/ssconvert/usage-draft.md and record required README approval;
      do not bypass the user's rule. Report local changes and any independently
      authorized commits separately from verified remote-main delivery/release.
      This plan authorizes no push/release; if later explicitly requested, use
      atomic owned-file Conventional Commits on main, manually run checks, push
      directly to main and monitor GitHub publication to success before
      reporting release completion.


      Before implementation, add a concrete failing regression or differential
      case. Use original small in-memory fixtures and memfs for unit file
      changes; unit tests must not spawn native utilities, query LLMs, or write
      files. Share the actual command/SDK engine, use injected byte I/O and
      cancellation, and preserve exact exit statuses, diagnostics, ordering and
      namespace effects. After implementation, use a different agent to
      stress/fix the implemented tool as required by
      packages/safe-bash/AGENTS.md; root retains export/integration/Git
      ownership. Run the narrowest maintained uncached build/test/lint checks
      covering the change, with cross-workspace checks when appropriate. Record
      verified coverage and every remaining mismatch; unsupported/unmeasured
      cases are not passes.
    status:
      implement: done
      test: done
setupCompleted: true
finalization: completed
name: ssconvert-javascript-safe-bash
state: archived
---

# ssconvert in JavaScript for safe-bash

Research date: 2026-09-17. Status: planning only; no conversion implementation or runtime parity has been verified.

## Required outcome

Run existing ssconvert commands unchanged inside safe-bash. The executable name, operands, flag names/short forms, exporter/importer IDs, quoting, diagnostics, channels, exit statuses, inferred names, numbered filenames and workbook effects must match the pinned native implementation. Do not introduce a replacement command language, convenient JSON schema or wrapper prompts that require agents to learn new syntax. Author the engine in TypeScript compiled to JavaScript; product execution cannot invoke native ssconvert, Gnumeric, LibreOffice, Python, Perl, Guile or another host conversion utility, and cannot disguise a compiled native engine as a JavaScript rewrite.

This is a spreadsheet engine, numerical calculation and rendering project as well as a converter. A CSV/XLSX library alone does not cover ssconvert. Full completion includes obscure formats, hidden options, imported workbook state, functions, solver/analysis and rendering behaviors; delivering a useful subset is a milestone, not full parity.

## Research evidence and limits

Primary research downloaded and read the released Gnumeric **1.12.61** archive, listed by the official release directory on 2026-Apr-30. Its SHA-256 was computed and matches the official checksum: **2ac135d856572713c1a408b76b50a59f2a9769ed21f1213446b5af255df20a12**. The initially inspected development mirror at commit **4c4b7d14afe12ef9fee1ad3d17819e163be37ef9** identifies itself as 1.12.62; a direct source diff found its src/ssconvert.c identical to released 1.12.61. The plan targets the released archive, not floating master.

Read: doc/ssconvert.1; src/ssconvert.c; src/libgnumeric.c; src/gutils.c common exporter handling; src/stf.c and stf-export.c; src/print-info.c PDF options; src/xml-sax-read.c and xml-sax-write.c registration; all plugins/\*/plugin.xml.in service metadata; src/func-builtin.c registration; and relevant test/t9001, t9005, t9006, t9007, t7200 and legacy importer tests. GOffice's go-image.c and go-glib-extras.c and GTK 3's gtkmain.c supplied supplementary image/option-grammar/inherited-group evidence. These supplementary branches were not frozen to the reference binary's dependencies; task freeze-reference-contract must pin them before runtime parity work.

No local ssconvert executable was found. Native commands were **not** run during planning. Static findings below are source-backed, while GLib option parsing details, inherited aliases, provider availability/default ordering, locale effects and rendering/solver results still require a reproducible oracle capture. This is not a claim to have exhaustively audited every workbook format record or every numerical algorithm; the source census tasks make those mandatory implementation prerequisites.

The repo currently has no workbook/spreadsheet SDK. packages/office-package exposes ZIP/compression only. docs/pandoc/xlsx-sdk-gate.md confirms the separately blocked reader integration; this plan proposes the missing reusable workbook engine without retroactively passing that gate. Existing safe-bash contracts use byte streams, FileSystem, CommandDefinition/VirtualShellPlugin and explicit trusted engine capabilities; src/commands/docx/index.ts illustrates the integration contract, not a usable spreadsheet backend.

Sources:

- [Official Gnumeric stable release directory](https://download.gnome.org/sources/gnumeric/1.12/)
- [Pinned release archive](https://download.gnome.org/sources/gnumeric/1.12/gnumeric-1.12.61.tar.xz)
- [Official checksum](https://download.gnome.org/sources/gnumeric/1.12/gnumeric-1.12.61.sha256sum)
- [Cross-checked ssconvert source](https://github.com/GNOME/gnumeric/blob/4c4b7d14afe12ef9fee1ad3d17819e163be37ef9/src/ssconvert.c)
- [Cross-checked manpage](https://github.com/GNOME/gnumeric/blob/4c4b7d14afe12ef9fee1ad3d17819e163be37ef9/doc/ssconvert.1)
- [GOffice image definitions](https://github.com/GNOME/goffice/blob/master/goffice/utils/go-image.c)
- [GOffice key-value grammar](https://github.com/GNOME/goffice/blob/master/goffice/utils/go-glib-extras.c)
- [GTK inherited options](https://github.com/GNOME/gtk/blob/gtk-3-24/gtk/gtkmain.c)

## Exact CLI inventory

Native usage: ssconvert [OPTION...] INFILE [OUTFILE]. Normal conversion accepts one or two operands; with one input, an explicit exporter may derive output from its extension. Merge uses ssconvert [OPTION...] --merge-to OUTFILE INFILE1 INFILE2 [...], with at least two input operands in stable main. Filenames and URIs are accepted; fd://0 and fd://1 are the documented stream URIs. A literal '-' is not assumed to be a stream alias.

| Option                  | Short             | Value/repeat             | Behavior and task                                                             |
| ----------------------- | ----------------- | ------------------------ | ----------------------------------------------------------------------------- |
| --version               | none in main      | flag                     | stdout version/datadir/libdir; inherited collision audited separately         |
| --verbose               | -v                | flag                     | exporter/resize diagnostics; no new UI                                        |
| --import-encoding       | -E                | ENCODING                 | importer charset override                                                     |
| --import-type           | -I                | ID                       | forced exact importer ID                                                      |
| --list-importers        | none              | flag                     | noninteractive import list to stderr                                          |
| --merge-to              | -M                | file                     | ordered workbook merge                                                        |
| --export-type           | -T                | ID                       | forced exporter; graph mode uses image ID                                     |
| --export-options        | -O                | string                   | exporter-specific ordered key=value grammar                                   |
| --list-exporters        | none              | flag                     | noninteractive export list to stderr                                          |
| --export-file-per-sheet | -S                | flag                     | scope-checked file splitting/templates                                        |
| --export-graphs         | none              | flag                     | graph objects to numbered images                                              |
| --list-image-formats    | none              | flag                     | GOffice enum-order list to stderr                                             |
| --set                   | none              | repeatable string        | cell/range updates, formula needs extra =                                     |
| --recalc                | none              | flag                     | force workbook-wide recalculation                                             |
| --resize                | none              | hidden string            | ROWSxCOLS sheet dimensions                                                    |
| --clipboard             | none              | hidden string            | clipboard target serialization to file                                        |
| --export-range          | none              | hidden string            | native range parsed before export                                             |
| --goal-seek             | none              | hidden repeatable string | native goal-seek range protocol                                               |
| --solve                 | none              | hidden flag              | active sheet's configured solver                                              |
| --tool-test             | none              | hidden repeatable string | first tool name, then key:value specs                                         |
| --lib-dir               | -L                | DIR                      | inherited library/config root behavior                                        |
| --data-dir              | -D                | DIR                      | inherited data root behavior                                                  |
| help/group flags        | probe -h          | flags                    | GLib help/all/libspreadsheet/GTK/GDK; --usage is manpage-only until validated |
| GTK/GDK/group aliases   | profile-dependent | mixed                    | inherited parser entries and observable effects need captured profile         |

Additional inherited source groups include version collision/group qualification, gtk-module, g-fatal-warnings and build-dependent GTK debug flags; GDK options require reference capture. They cannot be silently accepted as harmless flags if they actually change module/config behavior. Arbitrary native plugin loading is incompatible with safe-bash's runtime rules; an unresolved port/mapping remains a named compatibility gap.

Stable action precedence: parser errors; version; explicit -S/-M conflict; set graph mode to split; initialize/activate plugins; exporter list; importer list; image list; clipboard; merge; normal conversion. Listings/ordinary errors use stderr, version uses stdout, and file/stream contents use their destination without a decorative header. Unknown forced importer/exporter returns 1; inability to guess an exporter returns 2. Other statuses and crash/warning paths need oracle validation.

Normal conversion ordering: exporter/name; importer; load; --set and automatic calculation; exporter options and sheet-selection validation; merge; repeated goal seeks; solve; analysis; resize; explicit recalc/automatic calculation; export-range/default sheet selection; split/save. Merge sources are not updated with --set. Exporter sheet options are configured on an initially empty destination before merge. Clipboard is a distinct path, not all ordinary flags plus clipboard.

## Exporter option inventory

| Handler                 | Accepted keys from reviewed stable source                                                                        | Required details                                                                       |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Common                  | sheet, active-sheet                                                                                              | repeated ordered names; = mandatory; active value ignored; save-scope validation       |
| Configurable text       | common + eol, charset, locale, quote, separator, format, transliterate-mode, quoting-mode, quoting-on-whitespace | default values and source property parsing; multi-character strings, byte encoding     |
| Plain CSV               | common handler                                                                                                   | does not gain configurable-text keys merely because both export delimited data         |
| PDF                     | common + object, paper                                                                                           | object lookup/selection; paper catalog; paper=fit graph behavior                       |
| Graph images            | resolution                                                                                                       | default 100; inclusive 1..10000; native atof grammar; no sheet options in this handler |
| Other registered savers | common unless a provider connects its own handler                                                                | audit native implementation, no invented general options                               |

Configurable-text documented modes: eol unix/mac/windows; format automatic/raw/preserve; transliterate-mode transliterate/escape; quoting-mode never/auto/always. Manual defaults include UTF-8 output, current locale, double quote, space separator, automatic formatting, escape transliteration, auto quoting and whitespace quoting true; verify initialization/runtime defaults before golden tests. The manpage documents formulas=true, but stable cb_set_export_option does not whitelist it. Exact 1.12.61 behavior must win over adding that documented feature speculatively.

GOffice key-value parsing is not argv parsing: quotes/escapes exist inside the already shell-quoted -O value, whitespace can surround =, empty values and repeated keys matter. No regex rewrite or whitespace split can implement the grammar faithfully.

## Complete source-declared file-format inventory

This table is derived by parsing the **released** XML service manifests, supplemented by core registrations. It lists source-declared services, including optional compile-time formats; it is not a native --list-\* capture. Interactive-only import is separately marked. Format extensions/IDs are not proof of complete record/version support. Each provider task must census every implemented native record/element, formula mapping, warning and loss behavior.

| ID                                | Import | Export | Export extension/scope/selection                               | Source                               |
| --------------------------------- | ------ | ------ | -------------------------------------------------------------- | ------------------------------------ |
| Gnumeric_Excel:excel              | yes    | —      | —                                                              | plugins/excel/plugin.xml.in          |
| Gnumeric_Excel:excel_biff7        | —      | yes    | xls / workbook (default) / no selection declaration            | plugins/excel/plugin.xml.in          |
| Gnumeric_Excel:excel_biff8        | —      | yes    | xls / workbook (default) / no selection declaration            | plugins/excel/plugin.xml.in          |
| Gnumeric_Excel:excel_dsf          | —      | yes    | xls / workbook (default) / no selection declaration            | plugins/excel/plugin.xml.in          |
| Gnumeric_Excel:excel_enc          | yes    | —      | —                                                              | plugins/excel/plugin.xml.in          |
| Gnumeric_Excel:excel_xml          | yes    | —      | —                                                              | plugins/excel/plugin.xml.in          |
| Gnumeric_Excel:xlsx               | yes    | yes    | xlsx / workbook (default) / no selection declaration           | plugins/excel/plugin.xml.in          |
| Gnumeric_Excel:xlsx2              | —      | yes    | xlsx / workbook (default) / no selection declaration           | plugins/excel/plugin.xml.in          |
| Gnumeric_GnomeGlossary:po         | —      | yes    | po / workbook (default) / no selection declaration             | plugins/gnome-glossary/plugin.xml.in |
| Gnumeric_OpenCalc:odf             | —      | yes    | ods / workbook (default) / no selection declaration            | plugins/openoffice/plugin.xml.in     |
| Gnumeric_OpenCalc:openoffice      | yes    | yes    | ods / workbook (default) / no selection declaration            | plugins/openoffice/plugin.xml.in     |
| Gnumeric_QPro:qpro                | yes    | —      | —                                                              | plugins/qpro/plugin.xml.in           |
| Gnumeric_XmlIO:sax                | yes    | yes    | gnumeric / workbook                                            | src/xml-sax-read/write.c             |
| Gnumeric_XmlIO:sax:0              | —      | yes    | xml / workbook                                                 | src/xml-sax-write.c                  |
| Gnumeric_applix:applix            | yes    | —      | —                                                              | plugins/applix/plugin.xml.in         |
| Gnumeric_dif:dif                  | yes    | yes    | dif / sheet / no selection declaration                         | plugins/dif/plugin.xml.in            |
| Gnumeric_glpk:glpk                | —      | yes    | cplex / sheet / no selection declaration                       | plugins/glpk/plugin.xml.in           |
| Gnumeric_html:html                | yes    | —      | —                                                              | plugins/html/plugin.xml.in           |
| Gnumeric_html:html32              | —      | yes    | html / workbook (default) / sheet-selection                    | plugins/html/plugin.xml.in           |
| Gnumeric_html:html40              | —      | yes    | html / workbook (default) / sheet-selection                    | plugins/html/plugin.xml.in           |
| Gnumeric_html:html40frag          | —      | yes    | html / workbook (default) / sheet-selection                    | plugins/html/plugin.xml.in           |
| Gnumeric_html:latex               | —      | yes    | tex / sheet / sheet-selection                                  | plugins/html/plugin.xml.in           |
| Gnumeric_html:latex_table         | —      | yes    | tex / sheet / sheet-selection                                  | plugins/html/plugin.xml.in           |
| Gnumeric_html:latex_table_visible | —      | yes    | tex / sheet / sheet-selection                                  | plugins/html/plugin.xml.in           |
| Gnumeric_html:roff                | —      | yes    | me / workbook (default) / no selection declaration             | plugins/html/plugin.xml.in           |
| Gnumeric_html:xhtml               | —      | yes    | html / workbook (default) / sheet-selection                    | plugins/html/plugin.xml.in           |
| Gnumeric_html:xhtml_range         | —      | yes    | html / range / no selection declaration                        | plugins/html/plugin.xml.in           |
| Gnumeric_lotus:lotus              | yes    | —      | —                                                              | plugins/lotus-123/plugin.xml.in      |
| Gnumeric_lpsolve:lpsolve          | —      | yes    | lp / sheet / no selection declaration                          | plugins/lpsolve/plugin.xml.in        |
| Gnumeric_mps:mps                  | yes    | —      | —                                                              | plugins/mps/plugin.xml.in            |
| Gnumeric_oleo:oleo                | yes    | —      | —                                                              | plugins/oleo/plugin.xml.in           |
| Gnumeric_paradox:paradox          | yes    | yes    | db / workbook (default) / no selection declaration             | plugins/paradox/plugin.xml.in        |
| Gnumeric_pdf:pdf_assistant        | —      | yes    | pdf / workbook / sheet-selection                               | src/print-info.c                     |
| Gnumeric_plan_perfect:pln         | yes    | —      | —                                                              | plugins/plan-perfect/plugin.xml.in   |
| Gnumeric_psiconv:psiconv          | yes    | —      | —                                                              | plugins/psiconv/plugin.xml.in        |
| Gnumeric_sc:sc                    | yes    | —      | —                                                              | plugins/sc/plugin.xml.in             |
| Gnumeric_stf:stf_assistant        | yes    | yes    | txt / workbook with sheet-selection; importer interactive-only | src/stf.c; src/stf-export.c          |
| Gnumeric_stf:stf_csv              | —      | yes    | csv / sheet / sheet-selection                                  | src/stf.c                            |
| Gnumeric_stf:stf_csvtab           | yes    | —      | —                                                              | src/stf.c                            |
| Gnumeric_sylk:sylk                | yes    | yes    | slk / sheet / no selection declaration                         | plugins/sylk/plugin.xml.in           |
| Gnumeric_xbase:xbase              | yes    | —      | —                                                              | plugins/xbase/plugin.xml.in          |

Core entries: Gnumeric_XmlIO:sax imports and exports .gnumeric; Gnumeric_XmlIO:sax:0 exports uncompressed .xml; Gnumeric_stf:stf_csvtab imports CSV/TSV; Gnumeric_stf:stf_assistant importer is interactive-only but its configurable text exporter is usable without interaction; Gnumeric_stf:stf_csv exports plain CSV with sheet save scope/selection; Gnumeric_pdf:pdf_assistant exports PDF. The generated table above includes these core entries.

No XLSB writer/reader, Excel 2003 XML writer, DBF writer, or arbitrary legacy writer is added without native registry evidence. A different format produced under a familiar extension never counts as that format's support. Generic ZIP/XML, OLE/CFB, encoding and binary record infrastructure must remain reusable rather than duplicating a workbook parser per provider.

## Workbook and computation fidelity

All codecs must account for sparse content versus blanks/empty strings, typed values/error codes, formula and cache presence, shared/array formulas, name scopes, sheet order/focus/visibility, dimensions, styles/number formats/date systems, metadata, merges, row/column sizing/hiding, print settings, validations/conditional styles/filters, comments/hyperlinks, drawings/images/charts, relationships/external references and imported solver settings. Match what Gnumeric preserves, rewrites, drops, warns about or rejects. This is Gnumeric conversion parity, not a promise of lossless round trips for all Microsoft Excel features such as macros or unsupported extensions.

Function coverage is not just SUM and IF: native built-ins plus 651 manifest entries in 25 source service groups were enumerated below. Entries are manifest declarations rather than an activated-runtime count; duplicate registrations, disabled plugins, aliases and built-ins must be reconciled by audit-complete-feature-register and calculation-core. Every descriptor needs arity/coercion/laziness/array/reference/domain-error and numerical tests. Do not count a generic #NAME? stub as implemented.

### plugins/fn-christian-date/plugin.xml.in / christian_datetime

`eastersunday`, `ascensionthursday`, `ashwednesday`, `pentecostsunday`, `goodfriday`.

### plugins/fn-complex/plugin.xml.in / complex

`complex`, `imabs`, `imaginary`, `imargument`, `imconjugate`, `imfact`, `imgamma`, `imigamma`, `iminv`, `imneg`, `imcos`, `imtan`, `imsec`, `imcsc`, `imcot`, `imarcsin`, `imarccos`, `imarctan`, `imarcsec`, `imarccsc`, `imarccot`, `imarcsinh`, `imarccosh`, `imarctanh`, `imarcsech`, `imarccsch`, `imarccoth`, `imsinh`, `imcosh`, `imtanh`, `imsech`, `imcsch`, `imcoth`, `imdiv`, `imexp`, `imln`, `imlog10`, `imlog2`, `impower`, `improduct`, `imreal`, `imsin`, `imsqrt`, `imsub`, `imsum`.

### plugins/fn-database/plugin.xml.in / database

`daverage`, `dcount`, `dcounta`, `dget`, `dmax`, `dmin`, `dproduct`, `dstdev`, `dstdevp`, `dsum`, `dvar`, `dvarp`, `getpivotdata`.

### plugins/fn-date/plugin.xml.in / datetime

`date`, `unix2date`, `date2unix`, `datevalue`, `datedif`, `day`, `days`, `days360`, `edate`, `eomonth`, `hour`, `minute`, `month`, `networkdays`, `now`, `second`, `time`, `odf.time`, `timevalue`, `today`, `weekday`, `workday`, `year`, `yearfrac`, `isoweeknum`, `isoyear`, `weeknum`.

### plugins/fn-derivatives/plugin.xml.in / derivatives

`cum_biv_norm_dist`, `opt_bs`, `opt_bs_delta`, `opt_bs_rho`, `opt_bs_theta`, `opt_bs_gamma`, `opt_bs_vega`, `opt_bs_carrycost`, `opt_garman_kohlhagen`, `opt_french`, `opt_jump_diff`, `opt_bjer_stens`, `opt_baw_amer`, `opt_exec`, `opt_miltersen_schwartz`, `opt_rgw`, `opt_forward_start`, `opt_time_switch`, `opt_simple_chooser`, `opt_complex_chooser`, `opt_on_options`, `opt_extendible_writer`, `opt_2_asset_correlation`, `opt_euro_exchange`, `opt_amer_exchange`, `opt_spread_approx`, `opt_float_strk_lkbk`, `opt_fixed_strk_lkbk`, `opt_binomial`.

### plugins/fn-eng/plugin.xml.in / engineering

`base`, `besseli`, `besselk`, `besselj`, `bessely`, `bin2dec`, `bin2hex`, `bin2oct`, `convert`, `dec2bin`, `dec2oct`, `dec2hex`, `decimal`, `delta`, `erf`, `erfc`, `gestep`, `hex2bin`, `hex2dec`, `hex2oct`, `hexrep`, `invsuminv`, `oct2bin`, `oct2dec`, `oct2hex`.

### plugins/fn-erlang/plugin.xml.in / erlang

`probblock`, `offtraf`, `dimcirc`, `offcap`.

### plugins/fn-financial/plugin.xml.in / financial

`accrint`, `accrintm`, `amordegrc`, `amorlinc`, `coupdaybs`, `coupdays`, `coupdaysnc`, `coupncd`, `coupnum`, `couppcd`, `cumipmt`, `cumprinc`, `db`, `ddb`, `disc`, `dollarde`, `dollarfr`, `duration`, `effect`, `euro`, `euroconvert`, `g_duration`, `fv`, `fvschedule`, `intrate`, `ipmt`, `irr`, `ispmt`, `mduration`, `mirr`, `nominal`, `nper`, `npv`, `oddfprice`, `oddfyield`, `oddlprice`, `oddlyield`, `pmt`, `ppmt`, `price`, `pricedisc`, `pricemat`, `pv`, `rate`, `received`, `rri`, `sln`, `syd`, `tbilleq`, `tbillprice`, `tbillyield`, `vdb`, `xirr`, `xnpv`, `yield`, `yielddisc`, `yieldmat`.

### plugins/fn-flt/plugin.xml.in / flt

`flt.max`, `flt.min`, `flt.nextafter`, `flt.radix`.

### plugins/fn-hebrew-date/plugin.xml.in / hebrew_datetime

`hdate`, `hdate_heb`, `hdate_month`, `hdate_day`, `hdate_year`, `hdate_julian`, `date2hdate`, `date2hdate_heb`, `date2julian`.

### plugins/fn-info/plugin.xml.in / info

`cell`, `countblank`, `error`, `error.type`, `expression`, `get.formula`, `get.link`, `info`, `isblank`, `iserr`, `iserror`, `iseven`, `isformula`, `islogical`, `isna`, `isnontext`, `isnumber`, `isodd`, `isref`, `istext`, `n`, `na`, `type`, `getenv`.

### plugins/fn-logical/plugin.xml.in / logical

`and`, `or`, `xor`, `not`, `iferror`, `ifna`, `ifs`, `switch`, `true`, `false`.

### plugins/fn-lookup/plugin.xml.in / lookup

`address`, `areas`, `array`, `choose`, `column`, `columnnumber`, `columns`, `flip`, `hlookup`, `hyperlink`, `indirect`, `index`, `lookup`, `match`, `offset`, `row`, `rows`, `sheet`, `sheets`, `sort`, `transpose`, `unique`, `vlookup`, `xlookup`, `xmatch`.

### plugins/fn-math/plugin.xml.in / math

`abs`, `acos`, `acosh`, `acot`, `acoth`, `agm`, `arabic`, `asin`, `asinh`, `atan`, `atan2`, `atanh`, `averageif`, `averageifs`, `beta`, `betaln`, `ceil`, `ceiling`, `cholesky`, `combin`, `combina`, `cos`, `cosh`, `cospi`, `cot`, `coth`, `cotpi`, `countif`, `countifs`, `csc`, `csch`, `degrees`, `digamma`, `eigen`, `even`, `exp`, `expm1`, `fact`, `factdouble`, `fib`, `floor`, `g_product`, `gamma`, `gammaln`, `gcd`, `gd`, `hypot`, `igamma`, `ilog`, `int`, `lambertw`, `lcm`, `linsolve`, `ln`, `ln1p`, `log`, `log10`, `log2`, `maxifs`, `mdeterm`, `minifs`, `minverse`, `mmult`, `mod`, `mpseudoinverse`, `mround`, `multinomial`, `munit`, `odd`, `odf.sumproduct`, `pi`, `pochhammer`, `power`, `quotient`, `radians`, `reducepi`, `roman`, `round`, `rounddown`, `roundup`, `sec`, `sech`, `seriessum`, `sign`, `sin`, `sinh`, `sinpi`, `sqrt`, `sqrtpi`, `suma`, `sumif`, `sumifs`, `sumproduct`, `sumsq`, `sumx2my2`, `sumx2py2`, `sumxmy2`, `tan`, `tanh`, `tanpi`, `trunc`.

### plugins/fn-numtheory/plugin.xml.in / num_theory

`isprime`, `ithprime`, `nt_d`, `nt_mu`, `nt_omega`, `nt_phi`, `nt_pi`, `nt_radical`, `nt_sigma`, `pfactor`.

### plugins/fn-numtheory/plugin.xml.in / bitwise

`bitand`, `bitlshift`, `bitor`, `bitrshift`, `bitxor`.

### plugins/fn-r/plugin.xml.in / rstat

`r.dbeta`, `r.dbinom`, `r.dcauchy`, `r.dchisq`, `r.dexp`, `r.df`, `r.dgamma`, `r.dgeom`, `r.dgumbel`, `r.dhyper`, `r.dlnorm`, `r.dnbinom`, `r.dnorm`, `r.dpois`, `r.drayleigh`, `r.dsnorm`, `r.dst`, `r.dt`, `r.dweibull`, `r.pbeta`, `r.pbinom`, `r.pcauchy`, `r.pchisq`, `r.pexp`, `r.pf`, `r.pgamma`, `r.pgeom`, `r.pgumbel`, `r.phyper`, `r.plnorm`, `r.pnbinom`, `r.pnorm`, `r.ppois`, `r.prayleigh`, `r.psnorm`, `r.pst`, `r.pt`, `r.ptukey`, `r.pweibull`, `r.qbeta`, `r.qbinom`, `r.qcauchy`, `r.qchisq`, `r.qexp`, `r.qf`, `r.qgamma`, `r.qgeom`, `r.qgumbel`, `r.qhyper`, `r.qlnorm`, `r.qnbinom`, `r.qnorm`, `r.qpois`, `r.qrayleigh`, `r.qsnorm`, `r.qst`, `r.qt`, `r.qtukey`, `r.qweibull`.

### plugins/fn-random/plugin.xml.in / random

`rand`, `randbernoulli`, `randbeta`, `randbetween`, `randbinom`, `randcauchy`, `randchisq`, `randdiscrete`, `randexp`, `randexppow`, `randfdist`, `randgamma`, `randnorm`, `randnormtail`, `randgeom`, `randgumbel`, `randhyperg`, `randlandau`, `randlaplace`, `randlevy`, `randlog`, `randlogistic`, `randlognorm`, `randnegbinom`, `randpareto`, `randpoisson`, `randrayleigh`, `randrayleightail`, `randsnorm`, `randstdist`, `randtdist`, `randuniform`, `randweibull`, `simtable`.

### plugins/fn-stat/plugin.xml.in / stat

`adtest`, `avedev`, `average`, `averagea`, `bernoulli`, `betadist`, `beta.dist`, `betainv`, `binom.dist.range`, `binomdist`, `cauchy`, `chidist`, `chiinv`, `chitest`, `confidence`, `confidence.t`, `correl`, `count`, `counta`, `covar`, `covariance.s`, `critbinom`, `cronbach`, `cvmtest`, `devsq`, `expondist`, `exppowdist`, `fdist`, `finv`, `fisher`, `fisherinv`, `forecast`, `frequency`, `ftest`, `gammadist`, `gammainv`, `geomdist`, `geomean`, `growth`, `harmean`, `hypgeomdist`, `intercept`, `kurt`, `kurtp`, `landau`, `laplace`, `large`, `leverage`, `linest`, `lkstest`, `logest`, `logfit`, `loginv`, `logistic`, `lognormdist`, `logreg`, `max`, `maxa`, `median`, `min`, `mina`, `mode`, `mode.mult`, `negbinomdist`, `normdist`, `norminv`, `normsdist`, `snorm.dist.range`, `normsinv`, `owent`, `pareto`, `pearson`, `percentile`, `percentile.exc`, `percentrank`, `percentrank.exc`, `permut`, `permutationa`, `poisson`, `prob`, `quartile`, `quartile.exc`, `rank`, `rank.avg`, `rayleigh`, `rayleightail`, `rsq`, `sftest`, `skew`, `skewp`, `slope`, `small`, `ssmedian`, `standardize`, `stdev`, `stdeva`, `stdevp`, `stdevpa`, `steyx`, `subtotal`, `tdist`, `tinv`, `trend`, `trimmean`, `ttest`, `var`, `vara`, `varp`, `varpa`, `weibull`, `ztest`.

### plugins/fn-string/plugin.xml.in / string

`asc`, `char`, `clean`, `code`, `concat`, `concatenate`, `dollar`, `encodeurl`, `exact`, `find`, `findb`, `fixed`, `jis`, `left`, `leftb`, `len`, `lenb`, `lower`, `mid`, `midb`, `numbervalue`, `proper`, `replace`, `replaceb`, `rept`, `right`, `rightb`, `search`, `searchb`, `substitute`, `t`, `text`, `textafter`, `textbefore`, `textjoin`, `textsplit`, `trim`, `unichar`, `unicode`, `upper`, `value`.

### plugins/fn-tsa/plugin.xml.in / TimeSeriesAnalysis

`interpolation`, `periodogram`, `fourier`, `hpfilter`.

### plugins/gda/plugin.xml.in / gdaif

`execSQL`, `readDBTable`.

### plugins/perl-func/plugin.xml.in / test

`perl_adder`, `perl_date`, `perl_sed`.

### plugins/py-func/plugin.xml.in / test

`py_printf`, `py_capwords`, `py_bitand`.

### plugins/sample_datasource/plugin.xml.in / ATL

`atl_last`.

Audit src/func-builtin.c separately: the descriptors are SUM, PRODUCT, GNUMERIC_VERSION, TABLE, NUMBER_MATCH, DERIV and IF. NUMBER_MATCH and DERIV registration is gated by the testsuite debug flag; TABLE is internal. Preserve actual registration/visibility and GNUMERIC_VERSION's observable value. Audit optional interpreted/external loaders separately; arbitrary user-supplied plugins are an extension contract, not an enumerable finite baseline.

## Hidden analysis and numerical operations

The stable run_tool_test dispatch supports the following 31 tool names, extracted from the function's explicit branches:

`regression`, `moving-average`, `anova`, `anova2`, `chi-squared-test`, `descriptive-statistics`, `correlation`, `covariance`, `fourier-analysis`, `sampling`, `ranking`, `exponential-smoothing`, `histogram`, `sign-test`, `frequency-tables`, `principal-components`, `auto-expression`, `normality-test`, `one-mean-test`, `wilcoxon-signed-rank-test`, `wilcoxon-signed-rank-test-two-samples`, `advanced-filter`, `wilcoxon-mann-whitney`, `sign-test-two-samples`, `f-test`, `t-test-paired`, `t-test-equal-variances`, `t-test-unequal-variances`, `kaplan-meier`, `z-test`, `fill-series`.

Each accepted tool includes every writable property/default/enum, special sheet/data/x/y/formulas handling, generated labels/cells/formulas/styles and statistical accuracy. Unknown tools retain native failure. GUI tools consolidate, random-generator and random-generator-cor are explicitly noted as missing from this test protocol; do not expose them through invented accepted names. Enumerating analysis tools is not enough: the source properties and output formulas must be fully audited.

Goal seek uses native range-based test mode, repeated in order; the exact cell layout/precision/bounds/failure behavior must be read from dialog-goal-seek.c and captured. Solver uses workbook-stored parameters and active sheet, selects functional algorithms by model type and may print errors while conversion continues. Matching command status is separate from matching optimal solution, convergence and report sheets. Optional native optimization plugins need actual JavaScript algorithms, not product subprocess calls.

## Graphics and printing

Graph mode exports graph objects only, traverses sheets, sorts objects by native anchor comparator and numbers emitted files globally from zero. A template without any percent gets .%n appended; %n/%s/%o/%% are native substitutions, unknown/trailing percent behavior must be preserved. -T switches to image ID; inference falls back to SVG; -O resolution is a graph-specific grammar. The supplementary GOffice source lists svg/png/jpeg/pdf/ps/emf/wmf/eps, with .jpg versus jpeg naming; not every listed image target is necessarily graph-renderable. Pin native list and unsupported-rendering failures rather than manufacturing a renderer for an unavailable native target.

Full print/PDF parity includes fonts/metrics, formatted text and rich styles, row/column sizing, hidden items, merges, drawings, print areas/titles, gridlines/headings, page breaks/order, scaling/fit, margins/orientation/paper sizes, headers/footers and selected objects. Compare rendered pages and chart geometry/images as well as status/diagnostics/names. PDF/ZIP/container metadata differences are not grounds to normalize away real content or layout defects.

## Architecture and capability boundaries

- Proposed domain workspace packages/ssconvert (@poe-code/ssconvert), with CLI parser, conversion engine, workbook SDK, declarative codecs, expression/calculation, formatting, objects/rendering and optimization/analysis. No real conversion logic in root CLI/core.
- Safe-bash virtual plugin registers ssconvert through CommandDefinition/VirtualShellPlugin. Existing commands and independent sealed inventory checks must be preserved; root owns export/aggregate integration. Registration policy and intended agent environment need a concrete integration decision, not a new user command name.
- Every product read/write uses the supplied VFS/byte streams. Real-root, memory and remote adapters are explicit host capabilities. No native utilities, ambient credentials, uncontrolled network, eval, native module discovery or automatic desktop clipboard access.
- JavaScript numerical/raster/legacy-format dependencies need a per-capability justification, licensing review, bounds and differential evidence. Prefer reuse and zero safe-bash runtime dependencies. A compiled Gnumeric WASM backend is outside the requested rewrite.
- Host byte/cell/iteration/graphics/temp budgets, env/locale/timezone/fonts/clock/random and descriptor/URI bindings are typed SDK configuration. Do not invent product CLI switches. Denials/budget failures remain documented observable divergences from unconstrained native execution.
- Every CLI operation has a real public SDK equivalent; parser error quirks stay at the CLI boundary. The future workbook SDK can satisfy other packages' XLSX needs only after their separate tests/gates pass.

## Execution and acceptance

Tasks execute in listed order, with per-feature failing tests before code. Select implement/test steps from the inspected project .poe-code/pipeline/steps.yaml; this plan overrides teardown so simply running the pipeline does not implicitly commit or push. Documentation/research tasks select implement only. Prompts include their own target, baseline, runtime constraints and validation rules; they do not depend on earlier prompts or this body being included at runtime.

Milestones: (1) frozen reference/specification and engine contracts; (2) workbook/calculation/text/native XML; (3) XLSX/XLS/ODF and complete legacy/document codecs; (4) merge/split/resize, charts/printing/clipboard/solver/analysis; (5) safe-bash/public SDK integration; (6) complete differential, adapter, shell and visual qualification. Early milestones are usable only with truthful format listings and explicitly scoped support. They do not satisfy the user's full compatibility goal.

Acceptance requires every feature/register row and every function/codec/tool descriptor accounted for, zero unexplained CLI/status/diagnostic/namespace mismatches for the pinned profiles, verified workbook semantics and independent interoperability, numerical accuracy with justified tolerances, and visual/render gates under recorded fonts/locales. Deterministic text/CLI artifacts compare bytes exactly; structured semantics and rendering are separate gates from any exact serialized-container gate. Proven native nondeterminism is profiled, never masked by blanket normalization. An oracle/plugin/service absent from the QA environment leaves an unmeasured blocker.

Native oracles/captures and expensive numerical/render/service checks stay outside fast canonical unit tasks. Unit tests use memfs/original in-memory inputs and no disk/native/LLM operations. Maintained checks are selective at each task, then broad for the cross-workspace integration. Every CLI-visible change gets ad hoc screenshot inspection; visual QA procedures are Markdown in docs/plans, not script-only QA or screenshot tests.

## Open decisions and delivery limits

1. Reproducible native runtime profile is still needed; 1.12.61 source is pinned and checksum-verified, but dependencies/fonts/locales/solver availability have not been measured.
2. Static source records alone are not exhaustive behavioral coverage. Every format version/record, function contract, analysis property and GOffice plot/type needs the mandatory census and test mapping.
3. Exact inherited native library/module/debug flags need safe VFS/config mappings or remain open divergence blockers. GUI-only plugins are excluded only after proving they do not affect this command; source-shipped optional command features are not silently excluded.
4. Full legacy codecs, iconv/transliteration, GOffice-style formatting, numerical functions/solvers and graphics are substantial engineering work. Existing spreadsheet/render libraries need evidence; no schedule or small effort is assumed.
5. New package README content needs explicit user permission under repository rules. Draft elsewhere, track it as a packaging/documentation blocker and publish only after approval.
6. User requested research and a plan only. This change does not authorize implementation, commits, pushes or release. Future delivery must report local commits, verified remote main and successful GitHub/npm publication separately, and monitor any authorized push to successful release.
