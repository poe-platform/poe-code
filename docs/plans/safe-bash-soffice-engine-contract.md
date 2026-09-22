# soffice parser and engine contract evidence

The `engine-soffice` parser/contract increment lives in
`packages/safe-bash-command-soffice` (package name `safe-bash-command-soffice`,
private, TypeScript ESM, no runtime or development dependency closure).
`packages/safe-bash/src/commands/soffice/index.ts` only exports its API. The
safe-bash manifest declares the public `/commands/soffice` route, local build
edge and private implementation profile. Existing maintained publication tooling
bundles the implementation and rewrites declarations; no new build bypass was
introduced. The package-pattern document currently lives in
`docs/plans/archive/safe-bash-command-package-pattern.md`.

The original tests were written before implementation and failed on the missing
engine API. Subsequent behavioral red/green tests covered supplied incomplete
CSV defaults, case-insensitive fixed-width tokens, malformed legacy booleans,
cat/script-cat event ownership, ordered import descriptors, endianness, and
caller budget/cancellation enforcement. Unit tests are pure and create no files,
query no LLMs and invoke no external capabilities.

Verification on 2026-09-20:

- `npm run test:unit --workspace=safe-bash-command-soffice`: 17 passing tests.
- `npm run lint --workspace=safe-bash-command-soffice`: ESLint and production/test
  TypeScript checks pass.
- ESLint for both soffice consumer fixtures and safe-bash export source passes.
- `npm run lint:packages -- --rule safe-bash-command-private --quiet`: passes.
- `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`: maintained
  selected workspace build closure passes, including native postbuild hooks.
- `scripts/package-safe.mjs` produces the three safe artifacts, with the soffice
  implementation and declarations inside safe-bash.
- The runtime fixture `scripts/fixtures/safe-packages-soffice.mjs` passes from an
  isolated consumer with only the generated safe-bash package linked. There is
  no soffice workspace package or command dependency installed in that consumer.
- The strict NodeNext/ES2022/DOM TypeScript fixture
  `scripts/fixtures/safe-packages-soffice-types.mts` passes with `types: []`,
  `noEmit: true`, and `skipLibCheck: false` against that artifact.
- Artifact traversal shows the public JS and declaration route both forward to
  `../../../safe-bash-command-soffice/index.js`. Its runtime bundle and relative
  declaration closure contain no bare unpublished imports or external modules.
- `git diff --check`: passes. Temporary artifacts and consumers under repository
  `out/` were removed after inspection.

These fixtures are retained for replay against installed artifacts; this increment
does not change the release workflow or claim a remote-main delivery/release.
Nothing was published.

Parser controls are source-based: LibreOffice/core
`d17755172ac96e54e3f10f35dd1b1680f0ef84bd`,
`desktop/source/app/cmdlineargs.cxx`. The current-event restrictions on outdir,
headless conversion, global overwritten conversion parameters, pre-conversion
open files, separate global cat/script-cat flags, and ordered infilter descriptors
are represented. The first colon separates forced-import name/options; the first
two export colons separate extension/filter/options, retaining further colons.
Unknown options and printing/listener/profile capabilities fail explicitly.
Genuine short options do not get deprecated-long warnings.

CSV export option controls were checked directly against pinned
`sc/source/ui/dbgui/imoptdlg.cxx`; import semantics are not substituted.
`include/tools/stream.hxx` establishes BIG=0 and LITTLE=1. Lowercase modern
booleans, twelfth-token sheet selector and thirteenth-token evaluation semantics
are represented. Encoding labels are retained; no encoding execution is claimed.
Strict product admission rejects weighted separator forms, malformed legacy
numeric booleans, surrogate separators and unsupported endianness values instead
of emulating permissive native numeric coercion. Actual sheet selection/export,
CSV quoting, fixed-width output, formula computation and filename/collision
preflight remain open.

The semantic model is a versioned adapter contract for styles, sections, images,
paragraphs/tables, links, headers/footers, footnotes and inert fields/parts. It is
not an implemented loss-preserving format adapter, spreadsheet/presentation model,
layout algorithm or complete representation of every Office feature.
Engine contracts require byte streams, explicit VFS operations, cancellation,
budgets and explicitly supplied licensed font assets with versioned metrics.
Cleanup of staged outputs remains callable after cancellation. No engine I/O,
publish operation or host fallback is implemented by this increment.

Whole existing engines remain inadmissible: office-package depends on pako;
DOCX reaches office-package; Pandoc depends on office-package, entities, jpeg-js,
jsonc-parser, parse5, saxes and PDF; PDF depends on pdf-lib, fontkit and pako.
No dependency source was silently bundled into the new command. No existing
ZIP/XML, format reader/writer, PDF, spreadsheet or layout engine was duplicated.
Audited first-party primitive integration remains a prerequisite.

All conversion admission fails explicitly. Independent false gates cover ODF,
pagination, shaping, spreadsheet formulas, slide masters, charts, PDF/A, PDF/UA
and notes rendering. PDF typed JSON and deterministic export-profile qualification,
renderer selection/ranges, font/shaping arithmetic, tables/footnotes/backtracking,
resource-bounded nonconvergence and original geometry/screenshot corpus checks
remain open. Conversion execution and CLI/SDK execution parity are not implemented;
the parser provides the shared future admission boundary. There is no visual CLI
change to screenshot in this increment. Native Office conversion remains
unqualified: installed 26.8.0.3 and stalled pre-main dyld attempts are separate from
the pinned source and establish no conversion, exit-status or rendering parity.
