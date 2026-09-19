---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
readiness: draft
setup:
  prompt: Execute tasks in listed order after reading root and relevant scoped
    AGENTS.md. Implement JavaScript csvkit2.2.0 compatibility as the exact14
    executable names for safe-bash with a frozen dependency/runtime profile, not
    new csvkit subcommands or Python csvkit fallbacks. Preserve unrelated
    edits/staging and root integration ownership. Use TDD and maintained
    uncached checks; independent-agent stress/fix follows code work. Plans/QA
    belong in docs/plans, scratch evidence in out. No README additions without
    permission or automatic commit/push/release. Static inventories are
    preparation, not product parity.
teardown:
  prompt: Report completed tasks/checks, exact command/format/operation/profile
    coverage and every failed/unmeasured/capability-divergent case. Reduce
    findings and purge only owned scratch evidence. Do not claim full csvkit
    compatibility from a subset or change unrelated edits/README content. Do not
    automatically commit/push/publish; any separately authorized local commit,
    verified remote main and successful release are distinct outcomes.
tasks:
  - id: freeze-csvkit-reference
    title: Freeze csvkit and dependency/runtime profiles
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Create docs/csvkit/reference-profile.json and docs/specs/csvkit.md.
      Acquire checksum-verified csvkit 2.2.0 from PyPI; capture its entry points
      and source/installed distribution hashes. Planning inspected Agate 1.14.2,
      agate-excel 0.4.2, agate-dbf 0.2.4 and agate-sql 0.7.3 source; reconcile
      this candidate dependency set with an actual isolated reference install
      and freeze the full transitive lock, including CPython, decimal context,
      Babel/CLDR, parsedatetime/python-dateutil/pytimeparse, openpyxl, xlrd,
      dbfread, SQLAlchemy, SQLite and compression versions. Record OS,
      locale/timezone, stdin/TTY/buffer behavior, PYTHONIOENCODING, output
      encoding, terminal width, warnings, optional zstandard/IPython/database
      driver and dialect entry-point profiles. Capture each of csvclean, csvcut,
      csvformat, csvgrep, csvjoin, csvjson, csvlook, csvpy, csvsort, csvsql,
      csvstack, csvstat, in2csv and sql2csv with --help, -V/--version and parser
      errors, separating stdout/stderr/status. No native csvcut was found during
      planning; runtime output is not already verified. Add additional supported
      CPython profiles where csv QUOTE_* choices differ; do not force the
      manual's 0..3 choices over runtime introspection.


      Research/specification only: validate claims against pinned source,
      dependency source or explicit oracle observations; capture provenance and
      unknowns. Do not change product code. Reduce findings before removing
      owned scratch evidence.
    status:
      implement: done
  - id: audit-all-features-and-tests
    title: Create a complete source-to-feature compatibility register
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Audit csvkit/cli.py, all 14 utilities, cleanup.py, grep.py,
      convert/__init__.py, fixed.py and geojs.py, docs/common_arguments.rst,
      every command reference/manpage and CHANGELOG for the pinned 2.2.0
      behavior. Parse all add_argument declarations, argument groups,
      override_flags, set_defaults and main control flow; record defaults,
      choices, required/repeated values, errors, action precedence and
      per-command applicability. Register the eight in2csv formats
      (csv/dbf/fixed/geojson/json/ndjson/xls/xlsx), all csvstat operations, JSON
      streaming paths, SQL dialect/driver services and csvpy interpreter modes.
      Census every csvkit test plus relevant Agate/Excel/DBF/SQL dependency
      cases; map each to an original canonical test, isolated oracle QA or
      explicit blocker. Document stale help, platform/version differences and
      source quirks rather than improving them silently. Classify third-party
      plugins separately from shipped baseline services; inventory licensed
      material and preserve required notices for any reuse.


      Research/specification only: validate claims against pinned source,
      dependency source or explicit oracle observations; capture provenance and
      unknowns. Do not change product code. Reduce findings before removing
      owned scratch evidence.
    status:
      implement: done
  - id: select-engine-and-reuse-boundaries
    title: Specify JavaScript engine boundaries and shared-package reuse
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Write docs/csvkit/architecture.md and public SDK/config contracts.
      Proposed domain workspace packages/csvkit/@poe-code/csvkit owns CLI
      grammar, CSV dialect/encoding, typed table inference/Decimal, operations,
      JSON/GeoJSON/fixed/DBF/Excel adapters, SQL schema/dialects/query/database
      drivers and Python REPL bridge; root CLI/core only wires packages. Inspect
      existing safe-bash xan CSV/selector/writer/regex modules before reuse:
      their byte/dialect semantics do not automatically match CPython/Agate and
      sealed historical tests must remain unchanged. Inspect
      packages/office-package public ZIP/compression APIs, the planned
      packages/ssconvert workbook SDK and packages/safe-python PythonSession
      public APIs. The ssconvert plan is not an implemented dependency; Excel
      needs an actual tested workbook API or its own deliberately scoped
      decoder, and Gnumeric formatted/recalculated values are not csvkit's
      openpyxl/xlrd cached-value semantics. PythonSession is a JavaScript
      interpreter, not proof that agate objects/modules or code.interact/IPython
      behavior already work. Prefer zero runtime dependencies inside safe-bash;
      isolate justified JS numeric/encoding/compression/SQL dependencies in the
      domain package. Select an explicitly bound SQLite-compatible engine with
      real SQL/transaction/VFS semantics; generic JavaScript SQL emulation is
      not assumed equivalent. Native database servers/transport are explicit
      trusted capabilities, not host command fallbacks.


      Research/specification only: validate claims against pinned source,
      dependency source or explicit oracle observations; capture provenance and
      unknowns. Do not change product code. Reduce findings before removing
      owned scratch evidence.
    status:
      implement: done
  - id: scaffold-csvkit-domain
    title: Create the domain workspace and capability contracts
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Create packages/csvkit with maintained strict TypeScript ESM build/export
      conventions, meaningful implementation modules and public SDK entry
      points. Define owned raw-byte argv, cwd/VFS, stdin provenance and terminal
      capability, stdout/stderr byte sinks, exported env/codec/locale/clock,
      cancellation/cleanup/budgets, database bindings and interpreter sessions.
      Use one declarative file per command and one per format/database provider;
      derive exact command inventory/dispatch/help/defaults/applicability from
      descriptors without provider-ID if/case wiring. Do not invent proxy-only
      layers or runtime ambient global state. A new package README is required
      but additions need user permission: prepare all usage/config/env content
      in docs/csvkit/usage-draft.md, track README publication as a delivery
      blocker and obtain permission only for that concrete final draft if
      execution reaches that point. Keep product API names/config honest and
      inspect export ownership before package wiring.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: argparse-compatible-parser
    title: Match argparse grammar, help and per-command option sets
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/cli matching argparse for each original
      executable: optional versus '*' FILE operands, default '-' input,
      help/version exits, long-option abbreviation/ambiguity, --name=value,
      short clusters/attached arguments, -- terminator, repeated store versus
      append actions, nargs '+' and nargs 2 consumption, negative
      integer/float-looking tokens, empty values, missing/unknown arguments and
      choices. Help must match
      usage/metavars/descriptions/epilogs/order/wrapping and status/channel
      under the recorded terminal/locale profile; -V prints '<command> 2.2.0'.
      Shared flags are filtered by each class override_flags, not blindly
      accepted. Examples: sql2csv repurposes -H as no output header and -e as
      query encoding; csvstack -n means grouping column name; csvgrep -f is
      match-file, in2csv -f is input format; csvformat suppresses inference
      options but -U 2 internally uses typed number inference. Preserve parser
      action/error timing, including argparse FileType opening csvgrep
      match-file during parse and special --null-value greediness. No new
      wrappers/subcommands/prompts/spinners/colors/JSON errors.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: diagnostics-and-errors
    title: Match exception names, warnings, statuses and output channels
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/diagnostics for argparse status 2 versus
      uncaught application status 1, csvclean validation status 1, help/version
      status 0 and source-specific success paths. Match
      CSV/column/header/field-limit/type/date/encoding/file/JSON/DB errors,
      warning categories/text/order and exact stderr/newline behavior.
      Nonverbose handler prints Python exception-class names and messages;
      UnicodeDecodeError has a custom encoding suggestion. -v requires a
      deliberate Python-compatible diagnostic/traceback contract, not a
      JavaScript stack or a promise of byte-identical deployment-specific Python
      paths. Capture path/frame/version variation and retain unresolved
      exact-traceback identity as a blocker rather than silently dropping
      verbose support. Distinguish delayed I/O from eager argparse match-file
      opens. Native SIGPIPE behavior must be mapped through safe-bash
      sink/pipeline semantics without mutating host signals; cancellation is not
      an ordinary parse error. Do not count quiet/no-match csvgrep as grep's
      status 1 unless measured.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: vfs-input-output-lifecycle
    title: Implement VFS paths, stdin, lazy opens and terminal provenance
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/io using injected FileSystem and byte
      streams: omitted FILE and literal '-' read stdin for most tools; in2csv
      requires an explicit format on stdin unless schema/key supplies it; csvpy
      rejects stdin CSV. Model LazyFile delayed open/error, physical-line
      iteration NUL stripping versus bulk-read behavior, skip-lines before
      parsing, repeated '-' and multi-pass/reopen effects in csvstack/in2csv,
      source filename labels and clean ownership. Match native
      additional_input_expected/TTY messages or parser errors using explicit
      terminal metadata; stdinIsDefault is not a TTY flag. Honor
      cwd-relative/absolute filenames and authorized VFS mounts only, with no
      automatic host URI/network access. Preserve file reads/side outputs under
      cancellation, exact partial stdout/stderr behavior and backpressure. Probe
      CR/LF universal newline translation and read/iterator differences. Windows
      wildcard/home/env expansion is a separate reference profile; do not
      duplicate shell glob expansion on POSIX.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: input-encoding-and-bom
    title: Match encoding defaults, aliases and output BOM behavior
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement UTF-8-sig input default or exported PYTHONIOENCODING override,
      Python-compatible encoding aliases/errors and source output-stream
      encoding behavior. Test UTF-8/UTF-16/legacy codepages, BOM stripping,
      invalid/truncated bytes, unsupported codec and environment suffix forms
      against the reference rather than treating TextDecoder as complete Python
      codec coverage. --add-bom writes raw UTF-8 bytes at the common run
      boundary even for non-CSV stdout modes if inherited; match empty
      output/error timing and avoid double BOM. sql2csv suppresses --add-bom and
      uses UTF-8 query input by default. --encoding-xls is a distinct workbook
      reader override. Use bounded injected JS codecs, no host iconv/Python
      fallback; output encoding mismatch remains a documented profile divergence
      rather than unconditional UTF-8 parity.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: compressed-inputs
    title: Implement compressed text inputs and optional zstandard profile
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement exact case-sensitive extension-based common input decompression
      for .gz, .bz2 and .xz, plus .zst only when the reference optional
      zstandard package is available. Without zstandard, native common opener
      treats .zst as ordinary text; preserve that behavior or record a host
      capability difference. Handle compressed stdin only when source actually
      supports it; stdin has no filename extension to auto-select compression.
      Use inspected office-package codecs where supported, qualified bounded JS
      implementations/explicit trusted codec providers otherwise; never spawn
      gzip/bzip2/xz/zstd. Protect against inflation bombs and
      concatenated/truncated member/codec errors while keeping native observable
      statuses/messages. in2csv guesses from the outer path extension before
      common opening; do not automatically guess inner .csv from .csv.gz unless
      the reference does. Binary Excel/DBF input takes separate source paths, so
      do not apply common text compression everywhere.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: python-csv-reader
    title: Implement CPython CSV parsing and physical line semantics
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/csv reader as a bounded state machine
      matching the frozen CPython csv dialect plus Agate wrapper:
      single-character Unicode delimiter/quote/escape validation, --tabs
      precedence, quoting choices, doublequote/escape behavior,
      --skipinitialspace, newline translation, quoted multiline/blank/trailing
      fields, malformed records, NUL removal by file iterator, BOM and
      zero/empty quotes. Match --maxfieldsize's character limit and
      FieldSizeLimitError with physical line number, not UTF-8 byte count. Track
      physical line_num versus logical row ordinal for multiline numbering and
      csvclean reports. Preserve CPython QUOTE_NONNUMERIC and newer QUOTE_*
      choices only where reference runtime defines them. Commands using raw
      readers do not automatically sniff or infer types. Do not substitute
      simplistic split(',') or configure native dependency behavior globally.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: python-csv-writers
    title: Implement Agate CSV/DictWriter serialization
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/csv writer and dictionary writer with
      default comma, double quote and LF (Agate differs from Python's default
      CRLF). Match quote/escape modes, embedded CR-to-LF conversion before
      serialization, booleans/null/Decimal/date/datetime/timedelta
      representation, blank records, trailing newline and DictionaryWriter
      extras/missing keys/duplicate headers behavior. --linenumbers writer adds
      'line_number' and emitted-row ordinal; reader numbering used by csvgrep
      uses 'line_numbers' and physical line numbers. Keep these distinct,
      including multiline inputs and filtered output. Reproduce QUOTE_NONNUMERIC
      typed output and newer runtime choices. Compare bytes rather than
      normalized newline text, and prevent a per-command dialect from leaking
      into another invocation.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: dialect-sniffing
    title: Match Agate and CPython dialect sniffing
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/csv/sniffer for Agate POSSIBLE_DELIMITERS
      comma/tab/semicolon/space/colon/pipe and frozen CPython csv.Sniffer
      heuristics. Typed commands expose -y/--snifflimit default 1024, 0 disabled
      and -1 entire file. Match quote/delimiter inference, explicit dialect
      overrides, failure warning and fallback. Agate source reads text-file
      samples in characters but stdin samples through buffer peek/decode,
      despite help describing bytes; capture those differences under a
      reproducible stream profile. Retain the sniffed prefix without
      dropping/reordering bytes and bound full sniffing separately from
      reference semantics. Do not apply -y to raw utilities that omit it. Test
      ambiguous/no-delimiter/empty/multiline samples and multibyte threshold
      boundaries, warning suppression and manual -d/-t precedence.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: headers-and-column-selectors
    title: Implement headers, column ranges and native edge cases
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/table headers and selectors from
      cli.make_default_headers/match_column_identifier/parse_column_identifiers,
      with Agate table-specific name deduplication separately audited. Default
      no-header names use a,b,...,z,aa,...; -n names output uses '%3i: name

      ', forbidden with -H for source helper tools. Resolve numeric names as
      positional indices, quoted literal name rules, duplicate names/first
      match, comma lists, -/: inclusive integer ranges, open-ended ranges and
      --zero. Selection preserves repetition/order; exclusions may ignore
      unknown columns and their open-ended defaults differ in source. Do not fix
      these differences by unifying two branches. csvjoin helper ignores --zero
      in reviewed source; csvjson geometry passes the Boolean zero_based as
      column_offset. Add pinned regression/quirk entries before implementing
      generic selectors so each actual command preserves its observable index
      behavior.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: typed-table-and-null-inference
    title: Implement Agate table inference and null semantics
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/table typed columns/rows with per-column
      inference using the source get_column_types ordering: Boolean, Number,
      TimeDelta, Date, DateTime, Text under default context, with Number
      repositioned for explicit date/datetime formats and number/text-only mode
      for csvformat -U 2. Match Agate TypeTester sampling/full inference,
      casting/duplicate or missing header warnings,
      blank/no-row/no-column/ragged tables and per-command raw versus typed
      paths. Default case-insensitive stripped null strings are
      empty/na/n/a/none/null/dot; --blanks empties that default set but
      --null-value adds values, and --no-inference still uses the Text null
      policy. Source --null-value is nargs '+' with ordinary store action
      despite help claiming repeatability: probe repeated occurrence/operand
      consumption and preserve actual behavior. --no-leading-zeroes affects
      numeric inference only. Typed values must not erase original distinctions
      where a raw command preserves them.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: decimal-arithmetic-and-serialization
    title: Implement Python Decimal arithmetic, comparison and precision
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement exact finite/nonfinite Decimal model or a qualified JS decimal
      dependency in packages/csvkit/src/types. Match Agate numeric casting from
      strings/int/float/bool, locale grouping/decimal/currency/percent
      stripping, leading-zero guards, exponent/sign/trailing precision, Decimal
      context/rounding and NaN/Infinity errors. Numbers beyond JavaScript's safe
      integer range cannot be coerced through Number for sorting/stats/schema
      sizing. Match arithmetic and decimal-to-CSV, keyed JSON normalized decimal
      keys, typed JSON float conversion and csvstat locale formatting as
      distinct paths. Preserve signed zero, precision metadata and sample
      standard deviation behavior. Define numeric QA tolerances only for
      operations whose reference algorithms justify them; exact text
      representations remain byte comparisons.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: dates-durations-locales
    title: Implement Boolean, date, datetime, duration and locale behavior
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement Agate Boolean/Text/Date/DateTime/TimeDelta
      parsing/casting/output and frozen locale/date dependency behavior. Cover
      accepted truth values, nulls/whitespace/Unicode case, strptime directives
      and explicit formats, implicit date/datetime recognition, timezone/offset
      and injected clock dependence, duration expressions, date-vs-number
      inference order and ISO/CSV/JSON/SQL conversion. Input numeric locale
      defaults en_US independently from operating system locale; csvstat output
      locale formatting needs separately recorded locale behavior. Do not rely
      on ambient JavaScript Date parsing or Intl as a parity guarantee.
      Enumerate Babel/CLDR/parsedatetime/pytimeparse features actually reached
      from these CLI commands and preserve their unsupported/domain-error paths.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvcut
    title: Implement csvcut column selection and empty-row deletion
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvcut executable from csvkit/utilities/csvcut.py in
      packages/csvkit/src/commands/csvcut.ts. Source-declared local arguments:
      -n/--names; -c/--columns; -C/--not-columns; -x/--delete-empty-rows. Shared
      arguments actually inherited after override_flags: FILE; -d/--delimiter;
      -t/--tabs; -q/--quotechar; -u/--quoting; -b/--no-doublequote;
      -p/--escapechar; -z/--maxfieldsize; -e/--encoding; -S/--skipinitialspace;
      -H/--no-header-row; -K/--skip-lines; -v/--verbose; -l/--linenumbers;
      --add-bom; --zero; -V/--version; argparse additionally supplies -h/--help.
      Do not expose flags omitted by this executable, and audit
      collisions/redeclared meanings.


      Implement names-only, ordered -c selection, -C exclusions and -x deletion
      after selecting output cells. Default selection includes all header
      columns; short rows emit empty cells, fields beyond header selection are
      not blindly retained and delete-empty considers selected output values,
      not the source row. No locale/inference flags: strings such as 001, false
      and null remain raw. Match -H, -K, --zero, column/header errors and line
      numbering. Use original cases for empty/no-column input, repeated columns,
      duplicate/numeric headers, missing/unknown exclusions, open-ended and
      reverse ranges, trailing blank cells and multiline input. Source helper
      error timing and names-only early return matter.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvgrep
    title: Implement csvgrep string, regex and match-file filtering
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvgrep executable from csvkit/utilities/csvgrep.py
      in packages/csvkit/src/commands/csvgrep.ts. Source-declared local
      arguments: -n/--names; -c/--columns; -m/--match; -r/--regex; -f/--file;
      -i/--invert-match; -a/--any-match. Shared arguments actually inherited
      after override_flags: FILE; -d/--delimiter; -t/--tabs; -q/--quotechar;
      -u/--quoting; -b/--no-doublequote; -p/--escapechar; -z/--maxfieldsize;
      -e/--encoding; -S/--skipinitialspace; -H/--no-header-row; -K/--skip-lines;
      -v/--verbose; -l/--linenumbers; --add-bom; --zero; -V/--version; argparse
      additionally supplies -h/--help. Do not expose flags omitted by this
      executable, and audit collisions/redeclared meanings.


      Implement -c required unless -n, pattern presence validation, -m substring
      matching, -r Python regex search and -f exact match-file membership;
      --any-match combines selected columns with OR instead of default AND and
      --invert-match complements the aggregate predicate. Preserve
      regex-versus-file-versus-string precedence from truthiness checks, empty
      patterns omitted by standardize_patterns, missing cells as empty strings,
      no-match/header-only output and native exit status. File lines use
      rstrip() in implementation, removing trailing whitespace beyond line
      separators despite help wording. Reader-based -l adds original physical
      source numbers before filtering and shifts selector offsets; it differs
      from renumbering matches. Argparse opens the match file eagerly, and -n
      does not necessarily prevent that parse-time effect. Keep common
      locale/type flags absent.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: python-regex-compatibility
    title: Implement bounded Python regex semantics for csvgrep
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Provide Python re-compatible regex search for csvgrep -r in
      packages/csvkit without assuming ECMAScript RegExp equivalence. Audit
      CPython syntax/Unicode classes/word boundaries/inline flags/anchors, named
      groups/backreferences, lookahead/lookbehind, conditionals,
      quantifier/empty-match and invalid-pattern messages as supported by the
      frozen version. Inspect existing safe-bash bounded regex infrastructure
      and safe-python support before choosing a shared portable engine; preserve
      their contracts and sealed tests. Use original JS parsing/VM or a
      qualified injected engine with proven Python dialect, cancellation and
      step limits; no native grep/Python subprocess fallback or unbounded
      main-thread regex. Host resource refusal is an explicit divergence. The
      repository ban on regex rewriting configuration does not remove this
      tool's essential -r feature.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvformat
    title: Implement csvformat dialect conversion and ASV output
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvformat executable from
      csvkit/utilities/csvformat.py in
      packages/csvkit/src/commands/csvformat.ts. Source-declared local
      arguments: -E/--skip-header; -D/--out-delimiter; -T/--out-tabs;
      -A/--out-asv; -Q/--out-quotechar; -U/--out-quoting;
      -B/--out-no-doublequote; -P/--out-escapechar; -M/--out-lineterminator.
      Shared arguments actually inherited after override_flags: FILE;
      -d/--delimiter; -t/--tabs; -q/--quotechar; -u/--quoting;
      -b/--no-doublequote; -p/--escapechar; -z/--maxfieldsize; -e/--encoding;
      -L/--locale; -S/--skipinitialspace; -H/--no-header-row; -K/--skip-lines;
      -v/--verbose; -l/--linenumbers; --add-bom; --zero; -V/--version; argparse
      additionally supplies -h/--help. Do not expose flags omitted by this
      executable, and audit collisions/redeclared meanings.


      Implement -E output-header skip, -D delimiter, -T tabs, -A ASCII separated
      values (unit separator U+001F, record separator U+001E), -Q quote, -U
      quoting, -B no-doublequote, -P escape and -M arbitrary output terminator.
      ASV overrides tabs/delimiter/terminator; tabs override delimiter. Preserve
      source common -L availability but omission of inference-related flags.
      Most paths stream raw rows with -H generated headers and skip-lines; -U 2
      materializes typed number/text inference and has distinct
      header/empty/null semantics. Match missing escape errors, quoted
      nonnumeric cells and source validation of delimiter/quote lengths/runtime
      QUOTE_* choices. Do not change the inherited input dialect when changing
      only output options.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvclean
    title: Implement csvclean checks, fixes and CSV error reports
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvclean executable from
      csvkit/utilities/csvclean.py in packages/csvkit/src/commands/csvclean.ts.
      Source-declared local arguments: --length-mismatch; --empty-columns;
      -a/--enable-all-checks; --omit-error-rows; --label;
      --header-normalize-space; --join-short-rows; --separator;
      --fill-short-rows; --fillvalue. Shared arguments actually inherited after
      override_flags: FILE; -d/--delimiter; -t/--tabs; -q/--quotechar;
      -u/--quoting; -b/--no-doublequote; -p/--escapechar; -z/--maxfieldsize;
      -e/--encoding; -S/--skipinitialspace; -H/--no-header-row; -K/--skip-lines;
      -v/--verbose; -l/--linenumbers; --add-bom; --zero; -V/--version; argparse
      additionally supplies -h/--help. Do not expose flags omitted by this
      executable, and audit collisions/redeclared meanings.


      Implement --length-mismatch, --empty-columns, -a enabling all checks,
      --omit-error-rows, --label (literal '-' resolves filename/stdin),
      --header-normalize-space, --join-short-rows/--separator and
      --fill-short-rows/--fillvalue. Require at least one check/fix;
      joining/filling are mutually exclusive. Match current 2.2.0 behavior:
      cleaned CSV on stdout, CSV error report on stderr with line_number,msg
      plus header and optional label, exit 1 only for retained errors. Do not
      resurrect historical _out.csv/_err.csv/-n behavior. RowChecker uses
      physical reader.line_num-1, header space normalization, incremental
      short-row edge-cell concatenation, removal of errors after successful
      joins, fill before checking and file-level empty-column
      counts/recommendations. --omit-error-rows follows source row-length
      condition rather than treating every file-level warning as a deletable
      row. Preserve header-only/no-data/blank/multiline rows and error ordering.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvsort
    title: Implement typed stable csvsort and case-insensitive ordering
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvsort executable from csvkit/utilities/csvsort.py
      in packages/csvkit/src/commands/csvsort.ts. Source-declared local
      arguments: -n/--names; -c/--columns; -r/--reverse; -i/--ignore-case;
      -y/--snifflimit; -I/--no-inference. Shared arguments actually inherited
      after override_flags: FILE; -d/--delimiter; -t/--tabs; -q/--quotechar;
      -u/--quoting; -b/--no-doublequote; -p/--escapechar; -z/--maxfieldsize;
      -e/--encoding; -L/--locale; -S/--skipinitialspace; --blanks; --null-value;
      --date-format; --datetime-format; --no-leading-zeroes; -H/--no-header-row;
      -K/--skip-lines; -v/--verbose; -l/--linenumbers; --add-bom; --zero;
      -V/--version; argparse additionally supplies -h/--help. Do not expose
      flags omitted by this executable, and audit collisions/redeclared
      meanings.


      Implement selected/all column tuple sorting, reverse and ignore-case with
      stable row order, typed Decimal/Boolean/date/duration comparisons and
      Agate NullOrder. ignore-case uses Python upper(), not locale
      collation/lower() or generic natural sorting. Match null placement under
      reverse, duplicate keys, original order for equal keys, Unicode
      expansion/casing, NaN/domain handling and output type normalization.
      Names-only returns through common helper before normal
      inference/materialization. Respect -I/-y/-H/--zero and source header
      warning behavior. Use sufficiently large original cases to expose
      incorrect lexicographic numeric sort without slow unit workloads.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvjoin
    title: Implement keyed and sequential csvjoin variants
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvjoin executable from csvkit/utilities/csvjoin.py
      in packages/csvkit/src/commands/csvjoin.ts. Source-declared local
      arguments: FILE ('*'); -c/--columns; --outer; --left; --right;
      -y/--snifflimit; -I/--no-inference. Shared arguments actually inherited
      after override_flags: -d/--delimiter; -t/--tabs; -q/--quotechar;
      -u/--quoting; -b/--no-doublequote; -p/--escapechar; -z/--maxfieldsize;
      -e/--encoding; -L/--locale; -S/--skipinitialspace; --blanks; --null-value;
      --date-format; --datetime-format; --no-leading-zeroes; -H/--no-header-row;
      -K/--skip-lines; -v/--verbose; -l/--linenumbers; --add-bom; --zero;
      -V/--version; argparse additionally supplies -h/--help. Do not expose
      flags omitted by this executable, and audit collisions/redeclared
      meanings.


      Implement inner default keyed join, --left, --right, --outer, and unkeyed
      sequential full-outer row-position join; one input is parsed and
      reserialized as a typed table, not raw file copy. -c is one key name/index
      shared across files or one key per input, not a general composite-key list
      for each file. Preserve per-input type inference, join
      multiplicity/duplicate keys/null equality, header name deconfliction,
      coalesced key columns, right-join reverse traversal and multi-file
      row/column ordering from Agate Table.join. Outer flags without columns
      error; left+right error; precedence for --outer combined with
      --left/--right follows source. Capture zero-based selector discrepancy
      (helper's default offset is used despite inherited --zero). Record
      intentional all-input materialization and bound it rather than claiming
      streaming joins.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvstack
    title: Implement csvstack header union and grouping
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvstack executable from
      csvkit/utilities/csvstack.py in packages/csvkit/src/commands/csvstack.ts.
      Source-declared local arguments: FILE ('*'); -g/--groups; -n/--group-name;
      --filenames. Shared arguments actually inherited after override_flags:
      -d/--delimiter; -t/--tabs; -q/--quotechar; -u/--quoting;
      -b/--no-doublequote; -p/--escapechar; -z/--maxfieldsize; -e/--encoding;
      -S/--skipinitialspace; -H/--no-header-row; -K/--skip-lines; -v/--verbose;
      -l/--linenumbers; --add-bom; --zero; -V/--version; argparse additionally
      supplies -h/--help. Do not expose flags omitted by this executable, and
      audit collisions/redeclared meanings.


      Implement all-file first-seen header union by dictionary reader, missing
      cells, extra fields/duplicate header behavior and no-header first-file
      width/positional stacking. -g comma-separated groups must match input
      count; -n names the new group column default 'group'; --filenames ignores
      -g and groups by basename. Match source stdin two-pass header/first-row
      caching, repeated '-' effects, -K per-file skipping and line-number writer
      output across files. Preserve group-column collision behavior and the
      reviewed no-header stdin-first-row path, including whether it gets a
      grouping cell. Do not silently normalize different header orders or infer
      types. Input file close/reopen failures and partial output ordering must
      be observable through injected VFS.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvjson
    title: Implement JSON and GeoJSON output with both stream paths
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvjson executable from csvkit/utilities/csvjson.py
      in packages/csvkit/src/commands/csvjson.ts. Source-declared local
      arguments: -i/--indent; -k/--key; --lat; --lon; --type; --geometry; --crs;
      --no-bbox; --stream; -y/--snifflimit; -I/--no-inference. Shared arguments
      actually inherited after override_flags: FILE; -d/--delimiter; -t/--tabs;
      -q/--quotechar; -u/--quoting; -b/--no-doublequote; -p/--escapechar;
      -z/--maxfieldsize; -e/--encoding; -L/--locale; -S/--skipinitialspace;
      --blanks; --null-value; --date-format; --datetime-format;
      --no-leading-zeroes; -H/--no-header-row; -K/--skip-lines; -v/--verbose;
      -l/--linenumbers; --add-bom; --zero; -V/--version; argparse additionally
      supplies -h/--help. Do not expose flags omitted by this executable, and
      audit collisions/redeclared meanings.


      Implement array JSON, unique-column keyed object, indent, Unicode output
      and --stream newline-separated objects. Preserve typed Agate JSON
      serializers (Decimal to float, dates ISO, durations),
      duplicate/null/Decimal-normalized keys, key column retained in object
      values, property order, separators/newline/ensure_ascii=False and
      nonfinite behavior from the reference. True incremental streaming occurs
      only with --stream -I -y 0 and no skipped lines; otherwise --stream still
      materializes/infer tables. Raw stream path uses first row as column names
      and missing cells null, with distinct duplicate/header/no-header edge
      behavior. GeoJSON requires both --lat and --lon even with --geometry;
      --type/--geometry/--crs require them, --no-bbox changes collection output,
      --key is feature ID and --stream emits individual features. Keep source
      schema/index/truthiness quirks for later GeoJSON-specific coverage.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: geojson-output-quirks
    title: Match GeoJSON geometry, bbox, CRS and falsey values
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/geojson for csvjson: ordered
      FeatureCollection/Feature properties, optional feature IDs, CRS named
      object, bbox recursion over supported coordinate shapes, --geometry JSON
      parsing and latitude/longitude point generation. Match source dropping
      null and other falsey property values, geometry absence when either
      numeric coordinate is zero due to truthiness checks, empty/invalid
      coordinate handling and failures caused by null/empty geometry in bbox
      processing. Source passes Boolean args.zero_based directly as
      column_offset; capture actual numeric column indexing rather than imposing
      shared selector semantics. Audit --type's consumed/excluded column
      behavior even if it does not alter generated point type. Preserve
      stream-versus-collection/no-bbox/indent behavior and keep known native
      bugs in compatibility register. Do not 'fix' zero coordinates, missing
      geometry, invalid CRS or empty collection into more standard GeoJSON
      without explicit scope change.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvlook
    title: Implement exact csvlook Markdown table rendering
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvlook executable from csvkit/utilities/csvlook.py
      in packages/csvkit/src/commands/csvlook.ts. Source-declared local
      arguments: --max-rows; --max-columns; --max-column-width; --max-precision;
      --no-number-ellipsis; -y/--snifflimit; -I/--no-inference. Shared arguments
      actually inherited after override_flags: FILE; -d/--delimiter; -t/--tabs;
      -q/--quotechar; -u/--quoting; -b/--no-doublequote; -p/--escapechar;
      -z/--maxfieldsize; -e/--encoding; -L/--locale; -S/--skipinitialspace;
      --blanks; --null-value; --date-format; --datetime-format;
      --no-leading-zeroes; -H/--no-header-row; -K/--skip-lines; -v/--verbose;
      -l/--linenumbers; --add-bom; --zero; -V/--version; argparse additionally
      supplies -h/--help. Do not expose flags omitted by this executable, and
      audit collisions/redeclared meanings.


      Implement Agate fixed-width Markdown-compatible table with --max-rows,
      --max-columns, --max-column-width, --max-precision and
      --no-number-ellipsis, typed inference/sniffing and optional line numbers.
      max-rows is passed to table loading as row_limit as well as rendering:
      changing it can change inferred types/widths, not just hide later rows.
      Match default precision 3, number grouping/alignment/ellipsis,
      date/duration/boolean/null strings, escaped control/multiline text,
      Unicode display width, column/row omission markers, empty tables and
      warning/error paths. Capture reference Agate print_table source/config and
      runtime terminal behavior; do not substitute repository design-system
      table output where bytes differ. Shared Agate config changes must remain
      invocation-local in the JS suite.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvstat
    title: Implement every csvstat metric and output mode
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvstat executable from csvkit/utilities/csvstat.py
      in packages/csvkit/src/commands/csvstat.ts. Source-declared local
      arguments: --csv; --json; -i/--indent; -n/--names; -c/--columns; --type;
      --nulls; --non-nulls; --unique; --min; --max; --sum; --mean; --median;
      --stdev; --len; --max-precision; --freq; --freq-count; --count;
      --decimal-format; -G/--no-grouping-separator; -y/--snifflimit;
      -I/--no-inference. Shared arguments actually inherited after
      override_flags: FILE; -d/--delimiter; -t/--tabs; -q/--quotechar;
      -u/--quoting; -b/--no-doublequote; -p/--escapechar; -z/--maxfieldsize;
      -e/--encoding; -L/--locale; -S/--skipinitialspace; --blanks; --null-value;
      --date-format; --datetime-format; --no-leading-zeroes; -H/--no-header-row;
      -K/--skip-lines; -v/--verbose; -l/--linenumbers; --add-bom; --zero;
      -V/--version; argparse additionally supplies -h/--help. Do not expose
      flags omitted by this executable, and audit collisions/redeclared
      meanings.


      Implement default detailed report plus names/column selection, type,
      nulls/non-nulls, unique, min/max, sum/mean/median/sample stdev, max text
      length, max Decimal precision, most-frequent values and total row count.
      Match operation applicability by inferred type, null exclusion,
      all-null/empty/single-row cases, frequency tie order/default count5 and
      --freq-count, scalar-versus-labeled multi-column output, full report
      labels/alignment/row count and Decimal formatting with --decimal-format/-G
      grouping. --csv and --json have their own schema/serializers and indent
      behavior; operation switches are mutually exclusive and cannot combine
      with CSV/JSON/count under source checks, while remaining precedence must
      be captured. Count is a raw reader fast path, not typed-table row count,
      and header subtraction on empty files may differ. Some displayed column
      IDs ignore --zero; preserve source behavior and record it. Every
      OPERATIONS entry and permitted type must have coverage.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: statistical-numerics-and-formats
    title: Implement Agate aggregates and Python-compatible statistics formatting
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement metrics consumed by csvstat using exact Decimal accumulation,
      sorting/quantiles/median, sample variance/stdev, min/max by type,
      unique/null membership, longest Python codepoint string length and
      MaxPrecision. Audit csvstat OPERATIONS aggregation classes/type filters;
      Boolean metrics are not implicitly the same as numeric ones. Match
      frequency Counter.most_common first-appearance tie behavior, null
      inclusion and negative/zero freq-count results. Detailed/scalar/CSV/JSON
      serializers differ: JSON converts Decimal to float and durations to
      seconds, CSV frequency loses counts into joined values, and locale
      %-format trailing-zero/dot stripping has quirks. Preserve class labels and
      finite/nonfinite handling; do not round everything to3 decimal places
      before calculations. Use original numerically sensitive tests and
      independent QA with documented tolerances where required.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-in2csv
    title: Implement in2csv dispatch, stdin rules and Excel sheet side outputs
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal in2csv executable from csvkit/utilities/in2csv.py in
      packages/csvkit/src/commands/in2csv.ts. Source-declared local arguments:
      FILE ('?'); -f/--format; -s/--schema; -k/--key; -n/--names; --sheet;
      --write-sheets; --use-sheet-names; --reset-dimensions; --encoding-xls;
      -y/--snifflimit; -I/--no-inference. Shared arguments actually inherited
      after override_flags: -d/--delimiter; -t/--tabs; -q/--quotechar;
      -u/--quoting; -b/--no-doublequote; -p/--escapechar; -z/--maxfieldsize;
      -e/--encoding; -L/--locale; -S/--skipinitialspace; --blanks; --null-value;
      --date-format; --datetime-format; --no-leading-zeroes; -H/--no-header-row;
      -K/--skip-lines; -v/--verbose; -l/--linenumbers; --add-bom; --zero;
      -V/--version; argparse additionally supplies -h/--help. Do not expose
      flags omitted by this executable, and audit collisions/redeclared
      meanings.


      Implement exactly csv/dbf/fixed/geojson/json/ndjson/xls/xlsx accepted -f
      values. Source format inference is csv/dbf/fixed/xls/xlsx extensions,
      json/js=>json and no extension=>fixed; it does not automatically infer
      .geojson/.ndjson/compressed inner extensions despite accepting those
      forced formats. -f wins, then schema implies fixed, then key implies json,
      then extension; stdin normally requires explicit/implied format. -n lists
      Excel sheets only. Implement --sheet, --write-sheets comma names/indices
      or '-' all, --use-sheet-names, --reset-dimensions and --encoding-xls with
      supported format-specific applicability/ignored flags. Main sheet
      conversion emits stdout before requested sheet CSV side files; filenames
      are base_i.csv or base_sheet.csv, base='stdin' for streamed workbook,
      indices are emitted enumeration starting0. Preserve selected/default
      active-sheet versus XLS first-sheet behavior, side-file encoding/dialect,
      collisions/reopen/partial failure. No ODS, XLSB or workbook writer is
      added unless a changed upstream baseline supports it.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: json-and-ndjson-import
    title: Implement ordered JSON table and NDJSON import
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement in2csv -f json/ndjson from Agate Table.from_json, -k top-level
      key navigation as actually accepted, ordered union of object fields,
      missing/null cells, duplicate key/order preservation, nested object/list
      serialization, scalar versus object/array root validation, UTF-8/codec/BOM
      and malformed records. Match newline mode's per-line parsing, empty lines,
      heterogeneous values, large Decimal/float conversions and skipped/common
      flags that are ignored for these formats. Do not flatten nested paths or
      preserve all raw JSON numeric tokens if native float/Decimal conversion
      changes them. Final output uses the typed table and actual inference/null
      policy, unlike raw fixed/GeoJSON converters. Map dependency source tests
      and original CLI cases to every supported root/value shape.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: fixed-width-import
    title: Implement fixed-width schemas and slicing behavior
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement in2csv -f fixed / -s schema using csvkit.convert.fixed. Schema
      is CSV with required column/start/length headers (extras ignored) and
      per-row integer conversions/errors labeled by schema line. Only the first
      data row's start==1 selects one-based positions for all fields; otherwise
      zero-based, independent of --zero. Match Python Unicode-codepoint slicing
      (including negative/zero lengths/indices as accepted), field strip(),
      overlap/out-of-order fields, short records, original physical lines and
      skip-lines. The converter writes raw schema/header/trimmed values through
      its own writer, ignores some global inference/line-number options and
      returns an empty string in streaming mode; preserve measured actual
      effects. Schema input uses common file opening/encoding/compression but no
      invented schema JSON format.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: geojson-import
    title: Implement FeatureCollection-to-CSV conversion
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement in2csv -f geojson using csvkit.convert.geojs, not the csvjson
      output inverse by assumption. Require root object type FeatureCollection
      and features; build header id, first-seen property names,
      geojson,type,longitude,latitude. Geometry is dumped with Python json
      defaults into the cell; point longitude/latitude use first two coordinates
      dropping altitude, other/null geometry gets absent coordinates. Preserve
      feature-ID/missing/null properties, ordered dict property JSON versus list
      representation, reserved-property name collisions, malformed
      features/geometry and validation messages. Output is a raw CSV converter
      and not automatically a typed Agate table, so ignored -I/-k/-l/common
      flags need evidence. No arbitrary root Feature/geometry flattening or
      property path expansion.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: dbf-import
    title: Implement DBF data, field types and companion-file behavior
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement in2csv -f dbf from agate-dbf/dbfread semantics in a bounded
      JavaScript codec or qualified existing workbook/table provider. Audit DBF
      header/record versions, field types/length/precision/codepages, deleted
      records, date/logical/number/memo values, DBT/FPT companion files,
      truncated/corrupt inputs and record order. in2csv requires a filename for
      DBF and reopens by name, not the text file's parsed bytes; do not add
      stdin support absent from source. Match default inference/field-derived
      types and Unicode/memo errors, explicit encoding behavior and ignored
      common flags. Only DBF reading/CSV output is in scope; no DBF writer.
      Native dbfread is reference tooling, not a product dependency.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: excel-import-cached-values
    title: Implement XLS/XLSX cached-value table extraction
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement in2csv xls/xlsx through actual tested JavaScript workbook reader
      APIs, reusing the planned ssconvert SDK only after it exists and exposes
      bounded raw/cache values. Native paths use xlrd/openpyxl data_only=True:
      formulas are not recalculated and absent caches/blank/styles/date/error
      cell results must match reader semantics. Audit BIFF/codepage
      --encoding-xls, OOXML namespaces/ZIP/relationships/shared
      strings/styles/date1900/1904 and date/time normalization, sparse/trailing
      cells, merged headers/cells, hidden sheets and duplicate/missing headings.
      XLS uses first sheet by default, XLSX active sheet; source --sheet strings
      versus --write-sheets digit-to-index conversions differ.
      --reset-dimensions True and native default auto-reset when reported
      A1-only require dedicated malformed-dimension fixtures. Read only Excel
      types native supports; Gnumeric displayed formatted text and computed
      values are not substitutes. Bound random access/stream caching and do not
      require a host spreadsheet process.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvsql
    title: Implement csvsql schema generation, database writes and queries
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvsql executable from csvkit/utilities/csvsql.py in
      packages/csvkit/src/commands/csvsql.ts. Source-declared local arguments:
      FILE ('*'); -i/--dialect; --db; --engine-option; --query; --insert;
      --prefix; --before-insert; --after-insert; --sql-delimiter; --tables;
      --no-constraints; --unique-constraint; --no-create;
      --create-if-not-exists; --overwrite; --db-schema; -y/--snifflimit;
      -I/--no-inference; --chunk-size; --min-col-len; --col-len-multiplier.
      Shared arguments actually inherited after override_flags: -d/--delimiter;
      -t/--tabs; -q/--quotechar; -u/--quoting; -b/--no-doublequote;
      -p/--escapechar; -z/--maxfieldsize; -e/--encoding; -L/--locale;
      -S/--skipinitialspace; --blanks; --null-value; --date-format;
      --datetime-format; --no-leading-zeroes; -H/--no-header-row;
      -K/--skip-lines; -v/--verbose; -l/--linenumbers; --add-bom; --zero;
      -V/--version; argparse additionally supplies -h/--help. Do not expose
      flags omitted by this executable, and audit collisions/redeclared
      meanings.


      Implement all local arguments with exact repeat/arity/validation: dialect
      choice or --db, repeated engine-option KEY VALUE parsed as Python
      literals, repeated --query (file-path precedence then naive
      --sql-delimiter split), insert/prefix/before-insert/after-insert, table
      names, constraints/unique, no-create/create-if-not-exists/overwrite,
      db-schema, chunk-size and text length controls. Query without --db creates
      in-memory SQLite and enables insert. Match validation/error order, DB
      connect before reading CSV, per-file table basename without outer
      extension or stdin, empty-table path, before/after hooks once per loaded
      table, all queries in order and only last row-returning query as CSV.
      Preserve transaction commit only after success and rollback/disposal on
      failure, writer line numbers/BOM and warnings. Schema-only path emits
      CREATE TABLE text, not INSERT statements. Do not silently alter delimiter
      splitting to a smarter SQL parser if native splits inside
      strings/comments.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: sqlalchemy-compatible-ddl
    title: Implement SQLAlchemy/Agate schema derivation and DDL
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/sql schema derivation and exact CREATE TABLE
      compilation for default/generic dialect plus every core dialect actually
      listed by the frozen SQLAlchemy profile (typically sqlite, postgresql,
      mysql, mssql and oracle; capture names/order rather than hardcoding a
      guessed choice list). Audit agate-sql
      SQL_TYPE_MAP/BOOLEAN_MAP/DATETIME_MAP/NUMBER_MAP/INTERVAL_MAP, nullable
      checks and unique constraints, precision/scale/text length from data,
      dialect-specific max lengths/fallback TEXT, quoting
      reserved/Unicode/numeric names, schema qualification, Boolean CHECK
      constraints, timestamp/interval representation and generated constraint
      names/order/whitespace. --min-col-len and --col-len-multiplier reach DB
      insertion path in source but are not passed to schema-only
      to_sql_create_statement; preserve that difference. Register dialect
      compiler providers declaratively; third-party entry-point dialects need
      optional-profile ports, not a universal supported list.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: sqlite-query-and-vfs-persistence
    title: Implement real SQLite-compatible queries and persistence
    prompt: |-
      Implement a JavaScript csvkit-compatible command suite for safe-bash, authored as TypeScript ESM in the proposed packages/csvkit domain workspace and registered through packages/safe-bash. Match released csvkit 2.2.0, PyPI source archive SHA-256 147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve the original 14 executable names and argv syntax; do not replace them with csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated edits and staging. No product subprocess or Python csvkit fallback; filesystem/network/database/interactive capabilities are explicitly injected. All plans/QA procedures belong in docs/plans, research/specifications in docs/csvkit and docs/specs, and temporary evidence in out. Do not add README content without permission. Do not commit, push or publish unless separately authorized.

      Provide an explicitly bound SQLite-compatible engine for csvsql --query and sql2csv default sqlite://, including in-memory and authorized VFS-backed file URLs, SQL grammar/operators/functions/joins/aggregation/ordering/subqueries/CTEs/DDL/DML/PRAGMA/transactions/collations/null/numeric/date/blob result semantics actually exposed by the reference SQLite version. A few SELECT/WHERE implementations or generic JS SQL library do not meet arbitrary query compatibility. Select and qualify a JavaScript-accessible engine and VFS adapter with cancellation/resource accounting and no host sqlite3 executable/ambient filesystem; if a generic engine uses WASM/internal native bindings, document that infrastructure capability explicitly rather than treating csvkit Python code as a compiled fallback, and respect authorized runtime constraints. Verify persistence, exclusive/locking/transaction/failure semantics supported by actual VFS capabilities; do not promise unsupported filesystem atomicity. Disallow unbound attach/load_extension/filesystem/URI features transparently as named host divergences. Every absent SQL capability remains a parity blocker.

      Use TDD for code: first reproduce the behavior with a failing original regression or differential case. Canonical unit tests use in-memory inputs/memfs, no file creation, native programs, network/LLMs or slow real databases. Compare exact stdout/stderr/status and file/database effects, then run the narrowest maintained uncached build/test/lint checks; expand checks for shared infrastructure/workspace integration. Product CLI and SDK share the actual engine. Preserve cancellation, stream ownership, backpressure and registered cooperative cleanup. Use a different agent to stress/fix implemented safe-bash tools as required by scoped instructions; root retains integration/export/Git ownership. Unimplemented, unsupported or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: database-provider-contracts
    title: Implement explicit database URLs, providers and option values
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement SQLAlchemy-like connection URL parsing, driver/dialect
      resolution and a declarative provider contract for csvsql/sql2csv with
      explicit credentials, authorized endpoints, cancellation and owned
      connection/transaction/result cleanup. Preserve URL escaping, sqlite
      memory/relative/absolute path identity, schemas, DB result column
      labels/types/order and exact missing-driver diagnostics. --engine-option
      and --execution-option values use cli.parse_list Python ast.literal_eval
      where successful (Boolean/None/numbers/strings/lists/dicts/tuples/sets),
      otherwise raw strings on ValueError; SyntaxError may escape and needs
      pinned regression. Never eval user values or pass arbitrary host
      constructor options unreviewed; supported provider option mappings need
      actual semantics, and rejected capabilities remain declared differences.
      Root core has no provider-specific if/case chains; one JS provider
      descriptor drives registration and help/dialect availability. Default
      plugins never automatically authorize network or ambient credentials.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: remote-database-and-insertion-behavior
    title: Implement core database transports and insertion semantics
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Port frozen reference-profile core PostgreSQL/MySQL/MariaDB/MSSQL/Oracle
      driver behaviors used by csvsql/sql2csv into explicitly configured
      JavaScript transports/providers with real optional service QA. Separate
      DDL compilation availability from connect/query/insert capability; an
      installed SQLAlchemy dialect does not prove its driver is present.
      Implement reflected existence/drop/create/create-if-not-exists/no-create
      behavior, schema selection, insertion batching/prefix expressions,
      unique/null/length enforcement, parameter conversion, driver errors and
      transaction commit/rollback according to agate-sql. Preserve partial
      stdout and database effects before failures, server-side cursor/result
      streaming and late cancellation cleanup. Do not silently support only
      SQLite and call every --db URL equivalent. Third-party dialects/database
      options need additional named providers/profiles; missing services remain
      unmeasured, not mock passes.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-sql2csv
    title: Implement sql2csv query sources and streaming result export
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal sql2csv executable from csvkit/utilities/sql2csv.py
      in packages/csvkit/src/commands/sql2csv.ts. Source-declared local
      arguments: --db; --engine-option; --execution-option; FILE ('?'); --query;
      -e/--encoding; -H/--no-header-row. Shared arguments actually inherited
      after override_flags: -v/--verbose; -l/--linenumbers; -V/--version;
      argparse additionally supplies -h/--help. Do not expose flags omitted by
      this executable, and audit collisions/redeclared meanings.


      Implement --query overriding FILE/stdin, UTF-8/default or -e query-file
      decoding, full-file query assembly, default sqlite:// DB, repeated
      engine/execution key-value pairs and source execution defaults
      no_parameters=True,stream_results=True. -H suppresses result-column
      header, unlike other tools' input-header flag; -l still has source writer
      header/first-row quirks when -H is used. Match connection before query
      file reading, single exec_driver_sql without csvsql's delimiter splitting,
      row-returning versus non-row results, duplicate/unnamed column labels and
      driver value serialization. csvkit source has no explicit commit in this
      path; capture DML rollback/autocommit behavior under frozen
      SQLAlchemy/driver instead of committing 'helpfully'. Always dispose owned
      resources, including errors where native cleanup is imperfect, while
      recording any changed observable effect. Do not accept ordinary input CSV
      dialect/type flags or --add-bom absent from this executable.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: command-csvpy
    title: Implement csvpy reader/table preload and Python shell
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement the literal csvpy executable from csvkit/utilities/csvpy.py in
      packages/csvkit/src/commands/csvpy.ts. Source-declared local arguments:
      --dict; --agate; --no-number-ellipsis; -y/--snifflimit; -I/--no-inference.
      Shared arguments actually inherited after override_flags: FILE;
      -d/--delimiter; -t/--tabs; -q/--quotechar; -u/--quoting;
      -b/--no-doublequote; -p/--escapechar; -z/--maxfieldsize; -e/--encoding;
      -L/--locale; -S/--skipinitialspace; --blanks; --null-value; --date-format;
      --datetime-format; --no-leading-zeroes; -H/--no-header-row;
      -K/--skip-lines; -v/--verbose; -V/--version; argparse additionally
      supplies -h/--help. Do not expose flags omitted by this executable, and
      audit collisions/redeclared meanings.


      Implement CSV-file-only interactive csvpy behavior: plain mode creates
      agate.csv.reader named reader, --dict creates agate.csv.DictReader named
      reader, --agate creates typed agate.Table named table; --dict wins if both
      flags set. Match file existence/filename access timing, skip-lines, reader
      header consumption, no-inference/sniffing in table mode, welcome banner
      and REPL prompt/output/EOF/exception behavior. csvpy rejects stdin CSV so
      REPL stdin remains available. Conversion/loading is JavaScript; Python
      language interaction needs a legitimate JavaScript interpreter session.
      Inspect and qualify existing packages/safe-python PythonSession and public
      namespace/object support; do not assume it already has agate/Table/reader
      modules, full Python stdlib or IPython. Extend a scoped object/library
      bridge and interpreter capabilities through maintained APIs/tests when
      required, without executing installed Python csvkit or spawning Python.
      Exact code.interact and optional IPython are separate recorded profiles;
      no JavaScript REPL replacement or silent removal of this command.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: csvpy-python-object-library
    title: Expose compatible Python reader, DictReader and Agate table objects
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit/src/python bridge and necessary scoped
      JavaScript safe-python capabilities for csvpy's preloaded objects. Match
      iteration/next/header/fieldnames/line_num, dictionary
      missing/extra/duplicate cells, generator exhaustion, typed table
      rows/columns/names/types, indexes/attribute access/repr and every Agate
      public API reachable in the agreed source-shipped csvpy object contract.
      Full arbitrary Python/Agate interactive APIs cannot be approximated by a
      handful of demo expressions; census the public object/method/config
      namespace and port/bridge required library functionality or leave explicit
      blockers. Sessions use injected VFS/stdio/budgets/namespace, not arbitrary
      host JS object access. Verify Python-native expressions, imports/error
      classes, printing and table methods through actual interpreter evaluation,
      preserving CPython/code.interact profile limits and optional IPython as
      separate qualification. A parser export or seeded stub named table is not
      support.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: sdk-operation-parity
    title: Expose every command operation through the public JavaScript SDK
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Expose packages/csvkit public compiled APIs for parse/write/dialects,
      selectors, clean reports/fixes, cut/filter/sort/join/stack,
      JSON/GeoJSON/fixed/DBF/XLS/XLSX input, JSON/table/stats rendering,
      schema/dialect generation, DB import/query/export and Python
      preload/session. Include all genuine flags/configuration, ordered repeated
      values, header/encoding/locale/sniff/type/null/line/BOM/output settings
      and host resource/DB/interpreter capabilities. SDK typed operations need
      not recreate malformed argv, but no operation may exist only behind CLI or
      only in SDK. Root CLI uses SDK if any poe-code wiring is added, without
      inventing a poe-code csvkit subcommand. Verify strict NodeNext
      declarations/public-consumer imports, byte ownership, browser-safe codec
      routes and documented optional capabilities. Link actual workbook SDK
      exports to the separate ssconvert plan without executing or modifying that
      plan's tasks.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: safe-bash-command-family
    title: Register all 14 commands and their engine capability bindings
    prompt: |-
      Implement a JavaScript csvkit-compatible command suite for safe-bash, authored as TypeScript ESM in the proposed packages/csvkit domain workspace and registered through packages/safe-bash. Match released csvkit 2.2.0, PyPI source archive SHA-256 147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve the original 14 executable names and argv syntax; do not replace them with csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated edits and staging. No product subprocess or Python csvkit fallback; filesystem/network/database/interactive capabilities are explicitly injected. All plans/QA procedures belong in docs/plans, research/specifications in docs/csvkit and docs/specs, and temporary evidence in out. Do not add README content without permission. Do not commit, push or publish unless separately authorized.

      Implement packages/safe-bash/src/commands/csvkit plugin/factory against CommandDefinition, VirtualShellPlugin, getCommandArguments, byte FileSystem/stdio contracts, exported env and registerCleanup. Register exactly csvclean/csvcut/csvformat/csvgrep/csvjoin/csvjson/csvlook/csvpy/csvsort/csvsql/csvstack/csvstat/in2csv/sql2csv, deriving definitions from domain descriptors with all-name collision preflight/one replacement policy. Decide explicit family versus intended default agent environment registration after dependency/startup review; database network/interpreter capabilities never become ambient authorizations. Forward owned argument bytes/cwd/stdin/default origin/signal/cleanup to genuine engine operations; core has no CSV/SQL/Agate logic and no empty proxy functions. Root integration/export owner handles package public/browser entry points. Synchronize maintained independent exact command inventories and literal integration-test path registrations if defaults change; never alter historical seals or derive expected names from the registry being tested.

      Use TDD for code: first reproduce the behavior with a failing original regression or differential case. Canonical unit tests use in-memory inputs/memfs, no file creation, native programs, network/LLMs or slow real databases. Compare exact stdout/stderr/status and file/database effects, then run the narrowest maintained uncached build/test/lint checks; expand checks for shared infrastructure/workspace integration. Product CLI and SDK share the actual engine. Preserve cancellation, stream ownership, backpressure and registered cooperative cleanup. Use a different agent to stress/fix implemented safe-bash tools as required by scoped instructions; root retains integration/export/Git ownership. Unimplemented, unsupported or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: budgets-streaming-and-isolation
    title: Enforce byte/table/regex/database/REPL budgets and cleanup
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Implement packages/csvkit host-configured limits for
      argv/input/output/retained/inflated bytes, codepoint fields/rows/columns,
      schema/JSON nesting, workbook ZIP entries/cells/styles, Decimal
      precision/work, regex steps, table sort/join expansion, sniff buffering,
      SQL query/statement/result/transaction resources and Python session work.
      Admit before allocation, copy retained mutable producer buffers, preserve
      await/backpressure and register cooperative cleanup before resource
      acquisition. Stream raw cut/grep/format/clean where source/output ordering
      permits; typed inference/sort/join/stats and some JSON paths legitimately
      materialize and need distinct budgets. Do not implement extra external
      sorting/temp fallback with altered semantics without evidence.
      Abort/provider failure cannot undo completed DB/file effects; verify
      cleanup settlement and late rejection handling. Invocation-local
      env/locale/Agate config/field-size settings must not mutate host global
      state or leak across concurrent commands. Budget/capability denial is a
      named divergence, not a native parse diagnostic.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: original-canonical-unit-corpus
    title: Build fast command and dependency-behavior regression suites
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Create original canonical tests covering every explicit/common option
      applicable to all14 tools, input dialect/encoding/header/selector edge
      cases, sniff/type/null/Decimal/date modes,
      cleaning/filtering/order/join/stack effects, JSON/GeoJSON serialization
      and quirks, every in2csv format, print/stats layout, SQL
      DDL/options/transaction contracts and csvpy Python objects. Use memfs and
      small in-memory generated workbook/DBF/SQL fake-driver inputs, no disk
      fixture generation or native commands in unit discovery. Mock
      transport/interpreter boundaries only when testing the host contract;
      actual parser/query/REPL algorithms require separate genuine engine tests,
      not canned successful results. Register maintained test inputs and public
      consumers under guarded scope. A copied upstream performance driver is not
      QA; slow service/large-corpus checks stay in explicit isolated campaigns.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: differential-oracle-and-coverage
    title: Qualify complete CLI byte and namespace compatibility
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Build explicit isolated native csvkit reference capture tooling and
      docs/csvkit/coverage.json, outside canonical unit discovery. Record
      binary/distribution/dependency/input/profile/source hashes,
      argv/stdin/env/TTY, stdout/stderr/status, before/after VFS files and DB
      transactions/results. Map every option/applicability/default/quirk and
      source branch to compared cases; census every upstream csvkit and reached
      dependency test with a ported case or unresolved explanation. Compare
      exact CLI/text/JSON/DDL/file bytes and statuses; structured
      workbook/DB/interactive semantics and timings are separately qualified.
      Warning/verbose trace source paths and native buffering/signal differences
      need evidence-based profile treatment, never blanket stderr normalization.
      Missing workbook codec, DB driver/service, interpreter/IPython or
      compression oracle is blocked/unmeasured. Keep historical failures and
      source quirks; no denominator reduction or claim of full support from
      subset pass totals.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: shell-pipeline-and-adapter-qa
    title: Execute real command pipelines and VFS workflows
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Write an agent-executed Markdown QA plan in
      docs/plans/csvkit-safe-bash-qa.md. Run actual safe-bash direct argv and
      VFS .sh scripts with csvcut -c name,amount | csvgrep -c name -m A |
      csvsort -c amount | csvlook; csvclean --length-mismatch with stderr
      redirection and PIPESTATUS; csvformat -T/-A; csvjoin -c id one.csv
      two.csv; csvstack --filenames; csvjson --stream -I -y 0; csvstat --json;
      in2csv -f xlsx fd-compatible VFS filename/stdin using '-' (do not invent
      ssconvert's fd://0 as a csvkit alias); csvsql --query 'select * from
      stdin' with CSV stdin; sql2csv --db configured URL --query and csvpy FILE
      with Python stdin. Verify quoting/expansion/pipes/status/byte ownership,
      side-file naming, BOM and raw/typed data. Exercise memory, configured
      real-root and mounted remote FS only where authorized; source file-command
      URIs are not automatically network capabilities. Database writes in QA use
      owned disposable fixtures/services, never production credentials.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: interactive-and-visual-qa
    title: Inspect table/help/error/REPL screenshots
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Execute visual sections of docs/plans/csvkit-safe-bash-qa.md for actual
      safe-bash csvlook tables, csvstat reports,
      names/help/version/argparse/warnings/error reports and csvpy
      banners/prompts/tracebacks. Use npm run screenshot-poe-code -- <inspected
      command> for existing user-visible poe-code routes and an appropriate
      terminal capture for actual safe-bash commands if no root forwarding route
      exists; do not invent a product subcommand. Inspect screenshots with
      view_image, including Unicode/wide/combining characters, long/multiline
      headers, max widths/rows/columns/precision and redirected stderr.
      CSV/JSON/data paths stay unstyled and preserve upstream formatting; do not
      replace with chalk/@clack/design-system tables. No screenshot tests, and
      QA remains Markdown executed by an agent rather than a script-only
      checklist. Store screenshots/logs in out and reduce/purge owned evidence
      after review.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: remote-service-and-engine-qa
    title: Verify database, workbook, compression and interpreter interoperability
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Execute isolated genuine optional-profile QA for SQLite persistence/SQL
      functions/transactions, configured core DB services/driver options/server
      cursors/error rollback, XLS/XLSX cache/date/sheet/dimension extraction,
      DBF memo/codepage records, gzip/bzip2/xz/zstd streams and csvpy
      interpreter/Agate/IPython profiles. Use independent tools for file/DB
      interoperability and compare native csvkit profile effects, not only
      output shape. No native product fallbacks or implicit network; unavailable
      services/plugins remain explicitly unverified. Validate workload
      performance only after semantic/byte equivalence, with bounded
      deterministic cohorts and actual hashes/profiles. Native oracle/test
      campaigns may create owned files only in out; canonical unit routes remain
      fast, in-memory and uncached. QA procedures live only in docs/plans.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
  - id: complete-parity-and-document-delivery
    title: Audit full suite parity and package delivery requirements
    prompt: >-
      Implement a JavaScript csvkit-compatible command suite for safe-bash,
      authored as TypeScript ESM in the proposed packages/csvkit domain
      workspace and registered through packages/safe-bash. Match released csvkit
      2.2.0, PyPI source archive SHA-256
      147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b, with a
      frozen CPython/Agate/SQLAlchemy/locale/driver reference profile. Preserve
      the original 14 executable names and argv syntax; do not replace them with
      csvkit subcommands. Follow root and scoped AGENTS.md; preserve unrelated
      edits and staging. No product subprocess or Python csvkit fallback;
      filesystem/network/database/interactive capabilities are explicitly
      injected. All plans/QA procedures belong in docs/plans,
      research/specifications in docs/csvkit and docs/specs, and temporary
      evidence in out. Do not add README content without permission. Do not
      commit, push or publish unless separately authorized.


      Audit docs/specs/csvkit.md, reference-profile.json, coverage.json and
      compiled product/public consumers for all14 command names, 23 common
      argument declarations plus implicit help, 135 local declarations including
      positional operands, eight input formats, every csvstat metric,
      source-shipped SQL/driver/interpreter/compression optional profile and
      known source quirks. Report
      implemented/failed/unmeasured/capability-divergent counts separately; zero
      unknown omissions are required and full parity is blocked by any
      unsupported source-shipped feature. Verify SDK parity and honest command
      availability, actual VFS/DB cleanup, meaningful current uncached
      builds/tests/lint and complete visual evidence. Use narrow workspace
      routes during development, broad maintained npm run build/npm
      test/repository lint for cross-workspace integration; workflow changes use
      npm run lint:workflows without workflow unit tests. Finish
      config/env/usage draft in docs/csvkit/usage-draft.md, track required
      README approval and do not add content without it. This request is
      plan-only: no automatic commits/pushes/releases. If later explicitly
      authorized, atomic owned-file Conventional Commits on main need manual
      pre-push checks and monitored GitHub release publication; report local
      commit, verified remote-main delivery and successful release separately.


      Use TDD for code: first reproduce the behavior with a failing original
      regression or differential case. Canonical unit tests use in-memory
      inputs/memfs, no file creation, native programs, network/LLMs or slow real
      databases. Compare exact stdout/stderr/status and file/database effects,
      then run the narrowest maintained uncached build/test/lint checks; expand
      checks for shared infrastructure/workspace integration. Product CLI and
      SDK share the actual engine. Preserve cancellation, stream ownership,
      backpressure and registered cooperative cleanup. Use a different agent to
      stress/fix implemented safe-bash tools as required by scoped instructions;
      root retains integration/export/Git ownership. Unimplemented, unsupported
      or unmeasured cases stay explicit blockers, never passes.
    status:
      implement: done
      test: done
setupCompleted: true
finalization: completed
name: csvkit-javascript-safe-bash
state: archived
---

# csvkit in JavaScript for safe-bash

Research date: 2026-09-17. Planning only; no product implementation or runtime parity has been verified.

## Required outcome and baseline

Rewrite csvkit's operations in JavaScript (TypeScript ESM authoring) and make its existing executables work unchanged inside safe-bash: **csvclean, csvcut, csvformat, csvgrep, csvjoin, csvjson, csvlook, csvpy, csvsort, csvsql, csvstack, csvstat, in2csv, sql2csv**. There is no single csvkit subcommand CLI to substitute. Preserve names, flags/short forms, operands, parser errors/help/version, data bytes, row/column order, inferred types, stdout/stderr/status, side files, database effects and Python object/REPL behavior. Existing AI commands must not need new syntax.

Pinned target: **csvkit 2.2.0**, released to PyPI 2025-12-15. Downloaded source SHA-256 **147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b** matched PyPI's published digest. Source setup.py declares exactly14 console entry points. AST parsing identified **23 common add_argument declarations** (including FILE/version) and **135 command-local declarations** (including redefined positional operands). argparse additionally supplies help, and dynamic choices/overrides must be frozen with dependencies. These are declaration counts, not distinct universal flags or passing test totals.

The released csvkit source does not upper-pin most dependencies. Matching 2.2.0 alone is insufficient: CPython CSV/parser/signal semantics, Agate inference/Decimal/print APIs, Babel locales, Excel/DBF readers, SQLAlchemy/SQLite and optional drivers/IPython/zstandard can change behavior. Planning downloaded and checksum-verified the following dependency source releases without installing or executing them:

| Dependency  | Inspected release | SHA-256                                                          |
| ----------- | ----------------- | ---------------------------------------------------------------- |
| agate       | 1.14.2            | 7f29841c39d84b1de7fde762b8d792085371515324f3a01413b20f810398225b |
| agate-excel | 0.4.2             | eed1dc6239f0e96720d962dc1bdfb4496e19687332c827fd8b1e587a917ea202 |
| agate-dbf   | 0.2.4             | 6554828b10048a76dbb5bc4eff8911e059ea2b47155b7a89351e382915ca16fc |
| agate-sql   | 0.7.3             | 4c588a28e80bc625c7d5f915e8f8dff4900140a8a6d8a350a098a2ba9adf9d33 |

This is a candidate source research profile, not a solved runnable lock. Freeze a full successful dependency/runtime profile before differential implementation. No local csvcut executable was found; native help/data commands were not run during planning. Source findings below are concrete; runtime formatting/parser boundaries/driver/interpreter behavior remain required oracle gates.

Primary sources:

- [csvkit PyPI release metadata](https://pypi.org/project/csvkit/2.2.0/)
- [Checksum-verified csvkit source archive](https://files.pythonhosted.org/packages/9a/bf/59b035abead12d9498c96dc05b965ec77683d3c794305dec2648e23830cc/csvkit-2.2.0.tar.gz)
- [Official command reference](https://csvkit.readthedocs.io/en/2.2.0/cli.html)
- [Common arguments](https://csvkit.readthedocs.io/en/2.2.0/common_arguments.html)
- [Upstream source repository](https://github.com/wireservice/csvkit)
- [agate 1.14.2 inspected source](https://files.pythonhosted.org/packages/16/48/dc4d02dba00fbe62e966ed1a7d991e51654668ab343a2738bb816aa82256/agate-1.14.2.tar.gz)
- [agate-excel 0.4.2 inspected source](https://files.pythonhosted.org/packages/83/e5/b2d1bc555fd91145de5d11a7b31241076586713d222881c6d7eac9e4fda9/agate_excel-0.4.2.tar.gz)
- [agate-dbf 0.2.4 inspected source](https://files.pythonhosted.org/packages/ad/d8/abf6f39bd8c5767cc367472ea59f7d7cc4d5728388974a1b26a9472a971f/agate_dbf-0.2.4.tar.gz)
- [agate-sql 0.7.3 inspected source](https://files.pythonhosted.org/packages/fe/fe/fc7662f1ec3c0917c377f74f143a479eb13c9ae5fe14d77ce28eb165564f/agate_sql-0.7.3.tar.gz)

Read all14 utility add_arguments/main implementations, cli.py, cleanup.py, grep.py, fixed.py, geojs.py, format inference and console registration; inspected command docs/manpages/tests and dependency CSV, table/JSON/inference/number/Excel/DBF/SQL implementations. This does not claim a complete branch audit of every dependency or arbitrary SQL/interpreter API; census tasks make that work mandatory before full-parity claims.

## Common CLI declarations

Source locations below are line numbers in the released csvkit/cli.py. Override groups are the source keys each executable filters; group I suppresses blanks/null/date/datetime/no-leading-zeroes, while local -I may separately mean no-inference. Do not derive behavior from a short flag letter alone.

| Argument                   | Action/arity/type/choices/default                  | Source line | Override group |
| -------------------------- | -------------------------------------------------- | ----------- | -------------- |
| `FILE`                     | nargs='?'                                          | 172         | f              |
| `-d`, `--delimiter`        | store one value (unless positional default)        | 176         | d              |
| `-t`, `--tabs`             | action='store_true'                                | 180         | t              |
| `-q`, `--quotechar`        | store one value (unless positional default)        | 184         | q              |
| `-u`, `--quoting`          | type=int; choices=QUOTING_CHOICES                  | 188         | u              |
| `-b`, `--no-doublequote`   | action='store_false'                               | 193         | b              |
| `-p`, `--escapechar`       | store one value (unless positional default)        | 197         | p              |
| `-z`, `--maxfieldsize`     | type=int                                           | 202         | z              |
| `-e`, `--encoding`         | default=os.getenv('PYTHONIOENCODING', 'utf-8-sig') | 206         | e              |
| `-L`, `--locale`           | default='en_US'                                    | 210         | L              |
| `-S`, `--skipinitialspace` | action='store_true'                                | 214         | S              |
| `--blanks`                 | action='store_true'                                | 218         | I              |
| `--null-value`             | nargs='+'; default=[]                              | 221         | I              |
| `--date-format`            | store one value (unless positional default)        | 224         | I              |
| `--datetime-format`        | store one value (unless positional default)        | 227         | I              |
| `--no-leading-zeroes`      | action='store_true'                                | 230         | I              |
| `-H`, `--no-header-row`    | action='store_true'                                | 234         | H              |
| `-K`, `--skip-lines`       | type=int; default=0                                | 238         | K              |
| `-v`, `--verbose`          | action='store_true'                                | 243         | v              |
| `-l`, `--linenumbers`      | action='store_true'                                | 249         | l              |
| `--add-bom`                | action='store_true'                                | 254         | add-bom        |
| `--zero`                   | action='store_true'                                | 260         | zero           |
| `-V`, `--version`          | action='version'                                   | 265         | always         |

Defaults: optional FILE omitted or '-' means stdin; input encoding PYTHONIOENCODING if exported, otherwise utf-8-sig; numeric inference locale en*US; skip-lines0; default column indices1-based unless the actual command has a source-specific offset quirk. Agate writer defaults LF, not Python writer's usual CRLF. Output stream encoding comes from the reference environment, not -e. --add-bom writes raw UTF-8 BOM before main. --null-value is nargs '+' with store action despite its repeatability help; runtime choices for -u/-U inspect CPython QUOTE*\* rather than hardcoded0..3.

The suite includes raw-reader utilities and typed-table utilities. Raw cut/grep/stack and most format/clean paths preserve text; they do not secretly add sniffing, normalization or inference. Typed sort/join/look/stat/JSON/CSV import paths can normalize values, nulls and dates. csvformat -U2 is a special typed number/text path despite suppressed inference flags. Streaming is a real distinct path, not an implementation marketing claim.

## Per-command inventory

Each table is the complete set of local add_argument declarations from csvkit/utilities/<command>.py; implicit argparse help and inherited common declarations after the listed override groups complete its parser. These tables describe source declaration shape, not runtime observations. Positional FILE/choice expressions need actual captured help/defaults.

### csvclean

Report and fix common errors in a CSV file.

Common override groups: `L`, `I`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument                    | Action/arity/type/choices/default           | Source line |
| --------------------------- | ------------------------------------------- | ----------- |
| `--length-mismatch`         | action='store_true'                         | 16          |
| `--empty-columns`           | action='store_true'                         | 19          |
| `-a`, `--enable-all-checks` | action='store_true'                         | 22          |
| `--omit-error-rows`         | action='store_true'                         | 25          |
| `--label`                   | store one value (unless positional default) | 28          |
| `--header-normalize-space`  | action='store_true'                         | 32          |
| `--join-short-rows`         | action='store_true'                         | 36          |
| `--separator`               | default='\n'                                | 39          |
| `--fill-short-rows`         | action='store_true'                         | 42          |
| `--fillvalue`               | store one value (unless positional default) | 45          |

### csvcut

Filter and truncate CSV files. Like the Unix "cut" command, but for tabular data.

Common override groups: `L`, `I`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument                    | Action/arity/type/choices/default           | Source line |
| --------------------------- | ------------------------------------------- | ----------- |
| `-n`, `--names`             | action='store_true'                         | 24          |
| `-c`, `--columns`           | store one value (unless positional default) | 27          |
| `-C`, `--not-columns`       | store one value (unless positional default) | 31          |
| `-x`, `--delete-empty-rows` | action='store_true'                         | 35          |

### csvformat

Convert a CSV file to a custom output format.

Common override groups: `I`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument                     | Action/arity/type/choices/default           | Source line |
| ---------------------------- | ------------------------------------------- | ----------- |
| `-E`, `--skip-header`        | action='store_true'                         | 15          |
| `-D`, `--out-delimiter`      | store one value (unless positional default) | 18          |
| `-T`, `--out-tabs`           | action='store_true'                         | 21          |
| `-A`, `--out-asv`            | action='store_true'                         | 24          |
| `-Q`, `--out-quotechar`      | store one value (unless positional default) | 28          |
| `-U`, `--out-quoting`        | type=int; choices=QUOTING_CHOICES           | 31          |
| `-B`, `--out-no-doublequote` | action='store_false'                        | 35          |
| `-P`, `--out-escapechar`     | store one value (unless positional default) | 38          |
| `-M`, `--out-lineterminator` | store one value (unless positional default) | 42          |

### csvgrep

Search CSV files. Like the Unix "grep" command, but for tabular data.

Common override groups: `L`, `I`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument               | Action/arity/type/choices/default           | Source line |
| ---------------------- | ------------------------------------------- | ----------- |
| `-n`, `--names`        | action='store_true'                         | 18          |
| `-c`, `--columns`      | store one value (unless positional default) | 21          |
| `-m`, `--match`        | action='store'                              | 24          |
| `-r`, `--regex`        | action='store'                              | 27          |
| `-f`, `--file`         | type=FileType('r'); action='store'          | 30          |
| `-i`, `--invert-match` | action='store_true'                         | 34          |
| `-a`, `--any-match`    | action='store_true'                         | 37          |

### csvjoin

Execute a SQL-like join to merge CSV files on a specified column or columns.

Common override groups: `f`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument               | Action/arity/type/choices/default           | Source line |
| ---------------------- | ------------------------------------------- | ----------- |
| `FILE`                 | nargs='\*'; default=['-']                   | 17          |
| `-c`, `--columns`      | store one value (unless positional default) | 20          |
| `--outer`              | action='store_true'                         | 25          |
| `--left`               | action='store_true'                         | 28          |
| `--right`              | action='store_true'                         | 32          |
| `-y`, `--snifflimit`   | type=int; default=1024                      | 36          |
| `-I`, `--no-inference` | action='store_true'                         | 40          |

### csvjson

Convert a CSV file into JSON (or GeoJSON).

Common override groups: none. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument               | Action/arity/type/choices/default           | Source line |
| ---------------------- | ------------------------------------------- | ----------- |
| `-i`, `--indent`       | type=int                                    | 16          |
| `-k`, `--key`          | store one value (unless positional default) | 19          |
| `--lat`                | store one value (unless positional default) | 23          |
| `--lon`                | store one value (unless positional default) | 27          |
| `--type`               | store one value (unless positional default) | 31          |
| `--geometry`           | store one value (unless positional default) | 35          |
| `--crs`                | store one value (unless positional default) | 39          |
| `--no-bbox`            | action='store_true'                         | 42          |
| `--stream`             | action='store_true'                         | 45          |
| `-y`, `--snifflimit`   | type=int; default=1024                      | 48          |
| `-I`, `--no-inference` | action='store_true'                         | 52          |

### csvlook

Render a CSV file in the console as a Markdown-compatible, fixed-width table.

Common override groups: none. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument               | Action/arity/type/choices/default | Source line |
| ---------------------- | --------------------------------- | ----------- |
| `--max-rows`           | type=int                          | 13          |
| `--max-columns`        | type=int                          | 16          |
| `--max-column-width`   | type=int                          | 19          |
| `--max-precision`      | type=int                          | 22          |
| `--no-number-ellipsis` | action='store_true'               | 25          |
| `-y`, `--snifflimit`   | type=int; default=1024            | 28          |
| `-I`, `--no-inference` | action='store_true'               | 32          |

### csvpy

Load a CSV file into a CSV reader and then drop into a Python shell.

Common override groups: `l`, `zero`, `add-bom`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument               | Action/arity/type/choices/default | Source line |
| ---------------------- | --------------------------------- | ----------- |
| `--dict`               | action='store_true'               | 16          |
| `--agate`              | action='store_true'               | 19          |
| `--no-number-ellipsis` | action='store_true'               | 22          |
| `-y`, `--snifflimit`   | type=int; default=1024            | 25          |
| `-I`, `--no-inference` | action='store_true'               | 29          |

### csvsort

Sort CSV files. Like the Unix "sort" command, but for tabular data.

Common override groups: none. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument               | Action/arity/type/choices/default           | Source line |
| ---------------------- | ------------------------------------------- | ----------- |
| `-n`, `--names`        | action='store_true'                         | 23          |
| `-c`, `--columns`      | store one value (unless positional default) | 26          |
| `-r`, `--reverse`      | action='store_true'                         | 30          |
| `-i`, `--ignore-case`  | action='store_true'                         | 33          |
| `-y`, `--snifflimit`   | type=int; default=1024                      | 36          |
| `-I`, `--no-inference` | action='store_true'                         | 40          |

### csvsql

Generate SQL statements for one or more CSV files, or execute those statements directly on a database, and execute one or more SQL queries.

Common override groups: `f`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument                 | Action/arity/type/choices/default           | Source line |
| ------------------------ | ------------------------------------------- | ----------- |
| `FILE`                   | nargs='\*'; default=['-']                   | 26          |
| `-i`, `--dialect`        | choices=DIALECTS                            | 29          |
| `--db`                   | store one value (unless positional default) | 32          |
| `--engine-option`        | nargs=2; action='append'; default=[]        | 35          |
| `--query`                | action='append'                             | 39          |
| `--insert`               | action='store_true'                         | 43          |
| `--prefix`               | action='append'; default=[]                 | 46          |
| `--before-insert`        | store one value (unless positional default) | 49          |
| `--after-insert`         | store one value (unless positional default) | 53          |
| `--sql-delimiter`        | default=';'                                 | 57          |
| `--tables`               | store one value (unless positional default) | 60          |
| `--no-constraints`       | action='store_true'                         | 64          |
| `--unique-constraint`    | store one value (unless positional default) | 67          |
| `--no-create`            | action='store_true'                         | 70          |
| `--create-if-not-exists` | action='store_true'                         | 73          |
| `--overwrite`            | action='store_true'                         | 76          |
| `--db-schema`            | store one value (unless positional default) | 79          |
| `-y`, `--snifflimit`     | type=int; default=1024                      | 82          |
| `-I`, `--no-inference`   | action='store_true'                         | 86          |
| `--chunk-size`           | type=int                                    | 90          |
| `--min-col-len`          | type=int; default=1                         | 93          |
| `--col-len-multiplier`   | type=int; default=1                         | 96          |

### csvstack

Stack up the rows from multiple CSV files, optionally adding a grouping value.

Common override groups: `f`, `L`, `I`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument             | Action/arity/type/choices/default           | Source line |
| -------------------- | ------------------------------------------- | ----------- |
| `FILE`               | nargs='\*'; default=['-']                   | 29          |
| `-g`, `--groups`     | store one value (unless positional default) | 32          |
| `-n`, `--group-name` | store one value (unless positional default) | 36          |
| `--filenames`        | action='store_true'                         | 39          |

### csvstat

Print descriptive statistics for each column in a CSV file.

Common override groups: none. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument                        | Action/arity/type/choices/default           | Source line |
| ------------------------------- | ------------------------------------------- | ----------- |
| `--csv`                         | action='store_true'                         | 74          |
| `--json`                        | action='store_true'                         | 77          |
| `-i`, `--indent`                | type=int                                    | 80          |
| `-n`, `--names`                 | action='store_true'                         | 83          |
| `-c`, `--columns`               | store one value (unless positional default) | 86          |
| `--type`                        | action='store_true'                         | 90          |
| `--nulls`                       | action='store_true'                         | 93          |
| `--non-nulls`                   | action='store_true'                         | 96          |
| `--unique`                      | action='store_true'                         | 99          |
| `--min`                         | action='store_true'                         | 102         |
| `--max`                         | action='store_true'                         | 105         |
| `--sum`                         | action='store_true'                         | 108         |
| `--mean`                        | action='store_true'                         | 111         |
| `--median`                      | action='store_true'                         | 114         |
| `--stdev`                       | action='store_true'                         | 117         |
| `--len`                         | action='store_true'                         | 120         |
| `--max-precision`               | action='store_true'                         | 123         |
| `--freq`                        | action='store_true'                         | 126         |
| `--freq-count`                  | type=int                                    | 129         |
| `--count`                       | action='store_true'                         | 132         |
| `--decimal-format`              | type=str; default='%.3f'                    | 135         |
| `-G`, `--no-grouping-separator` | action='store_true'                         | 139         |
| `-y`, `--snifflimit`            | type=int; default=1024                      | 142         |
| `-I`, `--no-inference`          | action='store_true'                         | 146         |

### in2csv

Convert common, but less awesome, tabular data formats to CSV.

Common override groups: `f`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument               | Action/arity/type/choices/default           | Source line |
| ---------------------- | ------------------------------------------- | ----------- |
| `FILE`                 | nargs='?'                                   | 29          |
| `-f`, `--format`       | choices=SUPPORTED_FORMATS                   | 32          |
| `-s`, `--schema`       | store one value (unless positional default) | 35          |
| `-k`, `--key`          | store one value (unless positional default) | 38          |
| `-n`, `--names`        | action='store_true'                         | 41          |
| `--sheet`              | store one value (unless positional default) | 44          |
| `--write-sheets`       | store one value (unless positional default) | 47          |
| `--use-sheet-names`    | action='store_true'                         | 50          |
| `--reset-dimensions`   | action='store_true'; default=None           | 53          |
| `--encoding-xls`       | store one value (unless positional default) | 56          |
| `-y`, `--snifflimit`   | type=int; default=1024                      | 59          |
| `-I`, `--no-inference` | action='store_true'                         | 63          |

### sql2csv

Execute a SQL query on a database and output the result to a CSV file.

Common override groups: `f`, `b`, `d`, `e`, `H`, `I`, `K`, `L`, `p`, `q`, `S`, `t`, `u`, `z`, `zero`, `add-bom`. Common flags not suppressed by these groups remain accepted, even when a particular code path ignores them.

| Argument                | Action/arity/type/choices/default                                                     | Source line |
| ----------------------- | ------------------------------------------------------------------------------------- | ----------- |
| `--db`                  | default='sqlite://'                                                                   | 14          |
| `--engine-option`       | nargs=2; action='append'; default=[]                                                  | 17          |
| `--execution-option`    | nargs=2; action='append'; default=[['no_parameters', True], ['stream_results', True]] | 21          |
| `FILE`                  | nargs='?'                                                                             | 29          |
| `--query`               | store one value (unless positional default)                                           | 32          |
| `-e`, `--encoding`      | default='utf-8'                                                                       | 35          |
| `-H`, `--no-header-row` | action='store_true'                                                                   | 38          |

## Complete feature families and compatibility traps

| Command   | Mandatory behavioral features                                                                                                                                                       |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| csvclean  | Width and empty-column checks, all-check switch, omit bad rows, label, header normalization, incremental short-row joining, fill, stdout cleaned CSV/stderr CSV diagnostics/status1 |
| csvcut    | Names/indices, ordered/repeated selected columns, exclusions/ranges, short-row padding, selected-empty-row deletion, no-header names/line numbers                                   |
| csvformat | Independent output dialect/quotes/escapes/newlines, skip header, TSV, ASCII unit/record separators and typed QUOTE_NONNUMERIC special path                                          |
| csvgrep   | Substring/Python regex/exact match-file, AND/OR across columns, aggregate inversion, missing cells, pattern precedence, source line numbering and empty patterns                    |
| csvjoin   | Typed inner/left/right/full-outer keyed join, per-file key mapping, unkeyed sequential join, duplicate/null multiplicity and multi-file/header/row order                            |
| csvjson   | Typed array/keyed JSON, raw/inferred NDJSON paths, uniqueness, indent/Unicode/date/number serializers, GeoJSON features/geometry/bbox/CRS/IDs                                       |
| csvlook   | Fixed-width Markdown table, typed/raw inference, row-limited load, widths/rows/columns/precision limits, locale alignment/ellipsis/Unicode/control text                             |
| csvpy     | File-only reader/DictReader/Agate table preload, named Python objects, Python code.interact and optional IPython profiles, genuine Python syntax/API behavior                       |
| csvsort   | Stable tuple sort, all/selected columns, typed ordering/nulls/Decimal, reverse, Python uppercase case-insensitive keys and names-only fast path                                     |
| csvsql    | Generic/core/extension dialect DDL, schema/type/constraints derivation, DB connect/create/drop/batch insert/hooks/prefixes, queries/file precedence/splitting, transaction/output   |
| csvstack  | First-seen header union/dictionary mapping, positional no-header mode, grouping/group-name/filenames precedence, stdin two-pass handling                                            |
| csvstat   | Type/null/non-null/distinct/min/max/sum/mean/median/sample stdev/length/precision/frequency/count, applicability, scalar/report/CSV/JSON and locale Decimal formatting              |
| in2csv    | Eight formats, extension/schema/key/forced-format precedence, Excel names/active/index selection/sheet side files/reset dimensions/codepage and stdin restrictions                  |
| sql2csv   | Query/file/stdin precedence, query encoding, DB/options/result streaming, output-header suppression and real transaction/autocommit behavior                                        |

Specific source findings that must become differential cases:

1. csvclean2.2.0 emits cleaned CSV to stdout and CSV errors to stderr; old \_out.csv/\_err.csv behavior is not this baseline. No checks/fixes is an argparse error. Reader physical line numbers matter for multiline records and corrections.
2. Agate Writer adds line_number plus emitted-row ordinals; Reader used by csvgrep adds line_numbers plus physical source line numbers. They are not interchangeable.
3. csvgrep -f strips all trailing whitespace with rstrip(), not only newline separators described in help. Empty pattern truthiness and precedence can yield unexpected filtering and must be preserved.
4. Selectors recognize numeric column names as indices, preserve repeated selections, allow -/: integer ranges/open ends and may ignore unknown exclusions. Inclusion/exclusion open-range defaults differ in source. csvjoin and csvjson GeoJSON do not consistently use the common --zero mapping.
5. csvjson truly streams only with --stream -I -y0 and no skipped lines; otherwise it materializes a table. Typed versus raw stream serialization/header/missing-cell semantics differ.
6. GeoJSON source drops falsey property values and creates point geometry only if both coordinates are truthy; zero coordinates/empty geometry/bbox can produce native defects. --type consumes/excludes a column but needs audit of actual effect. Compatibility work must not silently correct those outputs.
7. Input types are inferred per column, including Boolean/Decimal/TimeDelta/Date/DateTime/Text. Explicit date/datetime formats reorder Number testing; -I preserves Text's null policy. Python Decimal must not pass through JavaScript Number during precise calculations or ordering.
8. Input encoding defaults to utf-8-sig/PYTHONIOENCODING; -e does not necessarily select output encoding. --add-bom can affect inherited non-CSV modes because it runs before main. Input '.gz/.bz2/.xz' decompression is filename-based; '.zst' depends on optional zstandard.
9. in2csv format inference is narrower than -f choices; no extension means fixed, .js means JSON, and .geojson/.ndjson/compressed inner extensions are not automatically recognized by guess_format. Excel binary reads and DBF filename reopening differ from common text opening.
10. XLSX uses cached values (data_only=True), not recalculation or Gnumeric formatted display; default active sheet differs from XLS first-sheet default. --write-sheets emits the main conversion then side CSVs with enumeration from0 or sheet names, including stdin base/reopen effects.
11. csvsql --query without --db creates in-memory SQLite and enables insertion; --query values can be filenames, then source naively splits SQL text by --sql-delimiter. Only the last query's row-returning result is written. Do not substitute a smarter statement splitter and change compatibility.
12. sql2csv -H means suppress output header and -e query-file encoding; it does not inherit normal CSV input flags/BOM. It has no explicit commit in source, so DML behavior follows frozen SQLAlchemy/driver transactions.
13. SQL option pairs use Python ast.literal_eval and last duplicate key wins. Only ValueError falls back to raw text; SyntaxError can escape. Preserve safe literal syntax/quirks without eval.
14. csvlook --max-rows affects table loading/inference, not just display. csvstat count is a raw-row fast path with its own header subtraction/empty-file behavior; report column IDs may ignore --zero.
15. csvpy is an actual Python shell. A JS prompt, fixed demo expression interpreter, empty object named table or a parser-only API is not compatible. Optional IPython is distinct from standard code.interact; both need explicitly scoped runtime profiles.

## Input formats and dependency semantics

| in2csv format | Required behavior                                                        |
| ------------- | ------------------------------------------------------------------------ |
| csv           | CSV/TSV/dialect inference, raw fast path versus typed table              |
| dbf           | DBF versions/field/codepage/memo semantics; filename required            |
| fixed         | CSV schema column/start/length; first start1 means one-based             |
| geojson       | FeatureCollection only; id/properties/geometry/type/lon/lat              |
| json          | Ordered object records, optional top-level key, typed table              |
| ndjson        | Newline JSON records, optional key, typed table                          |
| xls           | xlrd-style BIFF cached values, first sheet default                       |
| xlsx          | openpyxl data_only cached values, active sheet default, reset dimensions |

All formats require original tests for malformed/empty/heterogeneous/Unicode inputs, ignored-versus-applicable flags, type/null conversion, errors and exact output bytes. DBF requires memo/field/codepage/version audit. Excel requires every cell/date/cache/header/dimension/relationship behavior actually reached by the reader dependency, without pretending its table extraction is a workbook writer. Fixed-width output is raw trimmed fields with its own schema/writer path; GeoJSON conversion similarly has its own raw serializer and ordered fields.

Python CSV/Agate writer behavior includes character-based field limits, physical-line tracking, Unicode delimiter validation, newer CPython quoting modes, embedded CR-to-LF normalization, raw versus typed row serializations, Boolean/date/duration output and DictReader/DictWriter edge behavior. Header name deduplication belongs to typed table construction, not every raw command.

## SQL and Python runtime scope

DDL support and database execution are separate capabilities. The default/generic plus frozen core SQLAlchemy dialects need exact quoted identifiers/type/nullability/length/precision/Boolean/unique/schema compilation, not generic CREATE TABLE approximations. Third-party dialect entry points are finite named optional profiles; arbitrary user-installed extensions cannot have an exhaustive prewritten list.

In-memory SQLite queries are ordinary csvsql functionality and must work, including arbitrary SQL allowed by the reference engine. Select a compatible JS-accessible engine/adapter rather than guessing a few SELECT statements cover it. Persistent SQLite files must respect the authorized VFS and actual storage guarantees. Network drivers require explicit endpoint/credential capability binding; PostgreSQL/MySQL/MariaDB/MSSQL/Oracle and source-listed optional drivers need genuine service QA where profiles promise them. Driver absence/native unsupported backends must reproduce measured failures; installed DDL dialect does not imply usable connection transport.

Database write operations are required product features. Implement create/no-create/create-if-not-exists/drop/overwrite/constraints/prefixes/hooks/batching and transactions against actual configured capabilities. No extra confirmation prompts in the compatible CLI. Capability refusal is host policy and an observable divergence, not a parity pass. Tests/QA use disposable owned databases, not production services.

csvpy conversion/loading remains JavaScript. Its Python shell can use the repository's **JavaScript** safe-python interpreter only after qualifying the actual public PythonSession namespace/library/object APIs and full required Python/Agate behavior. No installed Python csvkit, Python subprocess or automatic engine load. Porting Agate table objects and interactive APIs is substantial work; PythonSession existing exports alone do not pass that gate. Full arbitrary Python/optional IPython semantics remain explicit blockers unless the promised profiles are actually supported.

## Proposed architecture and integration

- Domain package packages/csvkit (proposed @poe-code/csvkit): declarative command descriptors, argparse boundary, byte CSV/parser/writer/sniffer/encodings, typed tables/Decimal/date/locale, operations, converters, JSON/GeoJSON/table/stats serializers, SQL compiler/providers and Python object bridge.
- Safe-bash command family registers the exact14 names, all-name collision preflight and coherent replacement policy. It forwards owned argv bytes/cwd/VFS/stdio/env/terminal/signal/cleanup to the domain engine. Registration/default-agent decision must preserve explicit DB/network/interpreter capabilities and maintained independent inventory assertions.
- Reuse existing xan/office-package/regex modules only after proving compatible semantics; preserve historical seals and avoid provider-specific root if/case wiring. New provider/command addition should be one declarative file with derived dispatch/help/availability.
- The separate ssconvert plan proposes a future workbook SDK. It is not available today, and csvkit needs cached/raw reader values rather than its Gnumeric-format/recalculation behaviors. Do not fabricate a successful dependency gate or automatically edit its plan.
- Every genuine CLI operation has a typed SDK equivalent with the same settings/capabilities. Argv errors/quirks remain at the parser boundary; no SDK-only feature gaps or duplicated CLI implementations.
- Safe-bash runtime dependencies stay empty where possible. Domain dependencies for exact Decimal/codecs/SQLite/interpreter infrastructure need explicit qualification/licensing/bounds and public consumer tests; no host executable conversion fallback.
- Budgets cover bytes/codepoints/rows/columns/joins/regex/Decimal/ZIP/inflation/SQL/result/REPL work and are SDK/host config, not invented compatible-CLI flags. Default suite cannot enable ambient host I/O, network, credentials or database extension loading.

## Execution and acceptance

Tasks run in listed order with self-contained prompts and common pinned scope/runtime/verification rules. Inspected .poe-code/pipeline/steps.yaml provides implement/refactor/test/commit/release; select implement/test for code and implement for research. This plan overrides setup/teardown and does not auto-commit/push/release. Research/source register work precedes implementation; TDD is mandatory for code. Independent agent stress/fix follows implementation under scoped safe-bash rules.

Milestones: frozen profile/register and architecture; CSV/parser/headers/encodings/inference/types; basic raw/typed operations; JSON/GeoJSON/stats/Excel/DBF/fixed; full SQL/dialects/drivers/Python REPL; SDK/safe-bash integration; complete oracle/adapter/visual/consumer qualification. Useful subset milestones do not complete the full compatibility request.

Acceptance requires all14 commands, all applicable explicit/implicit options/defaults/parser paths, all eight input formats, every metric/type/dialect/driver/REPL/compression profile and every registered quirk tested with concrete current evidence. Compare deterministic stdout/stderr/file/JSON/DDL bytes, status/order and namespace/database effects exactly. Separately qualify DB transactions, workbook table extraction, numerical algorithms, stream cancellation, interactive Python objects and visual layout. Runtime-specific trace/warning source paths, buffering/SIGPIPE and resource-policy differences are named gaps requiring measured scope; no blanket normalization or skipped-case passes.

Canonical units are fast/original/in-memory/memfs and never query native programs/LLMs/network or create files. Expensive native/service/interpreter/corpus QA is isolated; procedures live in docs/plans and logs/screenshots in out, reduced then purged. Visual CLI changes require ad hoc screenshot inspection, not screenshot tests. Cross-workspace integration gets maintained uncached build/npm test/lint routes without replacing normal workspace closure.

## Open gates

1. Runnable locked native reference is still required; source/hash/declaration inventory is researched, runtime behavior is not already verified.
2. Exact Python CSV/argparse/Decimal/Babel/inference/date/SQL/REPL behavior cannot be inferred from similarly named JavaScript libraries; dependency qualification is a mandatory gate.
3. Pure JS cached-value Excel/DBF codecs and proposed ssconvert SDK are not available by assumption. Engine/library/source feature census remains required.
4. SQL and Python interactive support are full functionality, not optional omissions from completion. Dynamic third-party extensions need explicit named ports/profiles, not a universal support claim.
5. Exact verbose traceback/frame identity and OS/TTY/signal/buffering variation require deliberate reference-profile treatment; inherited -v must not silently become a JS stack or no-op.
6. New package README additions need user permission; prepare the complete config/env/usage draft elsewhere and track publication as a delivery gate.
7. This request creates a researched plan only; no product execution, commits, pushes or release. Future authorized delivery must distinguish local commits, verified remote main and successful GitHub publication and monitor every authorized push through release success.
