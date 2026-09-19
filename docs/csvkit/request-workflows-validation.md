# Requested csvkit safe-bash workflows

This pass extends the existing JavaScript suite; it does not establish complete
csvkit 2.2.0 compatibility. The procedure is
`docs/plans/csvkit-safe-bash-qa.md`. Product execution uses the shared TypeScript
ESM domain engine and the fourteen original registered executable names. No
product subprocess or Python csvkit fallback was introduced.

Product checks use the current uncommitted working tree with unrelated edits
preserved. They do not qualify a frozen committed archive, remote main or release.

## Reference qualification

The isolated reference's CPython 3.14.2 executable hash and nineteen runtime
distribution versions were rechecked against `reference-profile.json`. A fresh
3,820,365-byte PyPI source download matched SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`.
Process environment was PATH=/usr/bin:/bin, LC_ALL=C, LANG=C, TZ=UTC,
PYTHONIOENCODING=utf-8, COLUMNS=80 and LINES=24. Agate 1.14.2 and SQLAlchemy
2.0.54 remain the selected typed-table/database reference. CPython 3.9.6 and
optional drivers were not substituted into this measurement.

Fourteen new native observations confirmed the measured pipeline stages,
csvclean diagnostics/status, tab and ASV output, join, filename stack, streaming
raw JSON, CSV-stdin query, XLSX named/dash inputs and Python-stdin reader console.
Two additional observations confirmed an owned SQLite query and XLSX stdin
side-file contents/names. These native programs are isolated QA oracles only.
The sql2csv oracle fixture uses DECIMAL with integral SQLite values; the product
fixture uses csvsql's inferred FLOAT schema and consequently returns `10.0` and
`2.0`. They are different schema fixtures, not an identical-schema differential.

Two capture defects were rejected before qualification: resolving the virtualenv
Python symlink discarded virtualenv discovery and produced fourteen import
failures; limiting the archive read to one million bytes truncated the archive.
The corrected capture retains the virtualenv executable path, and the corrected
bounded archive read verifies the full digest. Neither failed capture is a
product failure or a passing oracle observation.

## Original regressions and effects

`csvkit-request-workflows.test.ts` executes actual VFS `.sh` scripts and literal
`CommandContext.invoke` argv, comparing bytes, diagnostic channels, status and
namespace effects. It measures:

- The exact csvcut/csvgrep/csvsort/csvlook pipeline with quoted filename expansion,
  numeric sorting and `0 0 0 0` PIPESTATUS. csvclean stderr redirection leaves
  pipeline stage statuses `1 0` and creates only explicitly redirected files.
- Literal filenames containing shell substitution text, tabs, ASV control bytes
  and raw JSON strings preserving `0010` and empty text.
- Join key deduplication, filename stack labels and exact frozen typed JSON
  statistics from a VFS script.
- XLSX VFS filename and `-` stdin conversion; `book_0.csv`/`book_1.csv` versus
  `stdin_0.csv`/`stdin_1.csv` side files with exact frozen contents.
- CSV stdin into the initialized injected SQLite WASM engine; insertion/query
  against an authorized memfs disposable database; unchanged database bytes after
  sql2csv and provider disposal. No production credentials/services are used.
- Actual `csvpy FILE` with a host terminal explicitly bound to Python stdin,
  raw reader representations, EOF and exactly one JavaScript guest closure.
  Interpreter resource limits are explicit. This is the scoped safe-python
  console profile, not full CPython/IPython/Agate object parity.

The independent agent's original duplicate-header differential failed before
the fix: `csvformat -U 2` called typed loading without header normalization.
The one-line fix enables the existing normalization path and injected warning
provenance. The original domain regression and actual registration regression
now match frozen stdout/stderr/status. Stress also checks reused Buffer views,
poisoning during finalization, BOM, NUL, Unicode and quoted pipeline bytes.

## Completed focused checks

| Maintained or focused route | Result |
| --- | --- |
| Selected csvkit workspace build closure | Passed after the fix |
| Maintained csvkit test task | 4,370 passed, one skipped, five TODO; 96 files |
| Maintained csvkit lint/source/test declarations | Passed |
| Independent rebuilt shell stress | 38 passed, one executed unresolved TODO |
| All csv/in2csv/sql2csv command files, before final side-file and direct-pipe cases | 2,089 passed, one skipped, two executed TODO; 2,092 total |
| Final requested workflows file | Eight passed, one executed unresolved TODO |
| Maintained safe-bash runner checks | 536 passed |
| Scoped ESLint for integration membership and new command tests | Passed |
| Maintained safe-bash declaration/consumer checks | Passed; 26 current consumer groups, no runtime acceptance claim |
| Normal repository build, including root suffix and bundle | Passed |
| Repository lint: ESLint, types and workflows | Passed on stable rerun; zero ESLint errors, two warnings outside this change |

The actual built four-stage output was rendered through the maintained terminal
screenshot tool and visually inspected: table columns align and amount values
appear in numeric order, 2 then 10. Temporary captures are reduced here and
removed after verification.

## Explicit blockers

Input quoting mode 2 remains an executed differential TODO: native csvformat
accepts quoted header plus unquoted numeric data and emits `a\n1.0\n`; product
returns status 78 for the non-string raw-record path. Removing its guard without
preserving numeric/null cell types and float formatting across raw commands is
not a compatibility fix.

An additional descriptor-path experiment, `in2csv -f xlsx /dev/fd/3 3< FILE`,
returns FileNotFoundError because safe-bash does not expose descriptor paths in
its VFS. It remains an executed TODO separate from successful ordinary filename
and `-` stdin cases. `fd://0` was not introduced as an alias.

The existing temporal hypothesis-order/Unicode-long-s blocker remains unresolved.
Real-root and deployed remote filesystems, real network database drivers, TTY,
IPython and the complete Agate Python object library are unmeasured here. No
authorized real-root/remote binding was supplied; file-command URIs do not grant
network capabilities. Explicit refusals, TODOs, skips and unsupported source-test
inventory entries are excluded from compatibility passes.

The first repository lint run exited 2 with 577 explicit input gaps after the
safe-js package directory changed size during workspace builds. It had zero
ESLint errors, but was incomplete and is not a pass. The maintained rerun after
build completion passed ESLint, repository types and workflow lint without
weakening input guards or changing unrelated files.

The first `npm test` attempt exited 1 after the shared Vitest phase: 133,839
passed, one failed, three skipped and five TODO across 2,903 files (2,900
passed, one failed, two skipped). The failure was the 100 ms deadline in
`poe-oauth.test.ts`'s pasted-callback-read rejection case. Its isolated rerun
passed in 4 ms; the complete OAuth file then passed all 56 tests in 52 ms.
No OAuth product defect was reproduced and no unrelated source was changed.
Those focused results do not turn the failed full run into a pass. Subsequent
declared native unit stages were not qualified by that aborted attempt.

The second maintained `npm test` attempt ran without concurrent local build or
lint work and exited 1. Its shared unit phase passed: 133,840 passed, three
skipped and five TODO, across 2,901 passing and two skipped files. Subsequent
OP (851), Pandoc (1,067) and safe-bash runner (536) checks passed. The complete
safe-bash task reported 42,545 tests: 41,695 passed, 24 failed, 824 skipped and
two executed TODO. The TODOs are the quoting-mode and descriptor-path cases
above; they are separate from the 24 failures. Later workspace tasks were not
qualified by this attempt.

Two failures are committed-archive admission checks: both archive-controls and
packed S3 export execution reject `scripts/build.mjs` because the committed
candidate differs from the reviewed live authority. The build script already
had unrelated changes when this pass began. Neither check reaches its runtime
assertions. No dirty source was overlaid onto a committed archive and no
authentication guard was relaxed. A coherent committed candidate and reviewed
authority remain required; this session has no authorization to commit.

The other 22 failures occur in the shared public native-cleanup setup: ten
grep/rg retirement cases and twelve tamper-refusal cases cannot prepare their
peer snapshot. `qualified-current-release/peer.mjs` rejects the first external
runtime route, `@e965/xlsx`, with `Unadmitted peer public route`. The current
root csvkit export brings this dependency into that authenticated runtime
closure, whose verifier currently admits only builtins, relative files and
`poe-code/` public routes (plus its exact private native boundary). This is an
unresolved integration qualification gap, not evidence of 22 individual worker
retirement defects. External dependency bytes, exports, transitive routes and
staging need authenticated closure support before those cases can execute;
an unrestricted package resolver or allowlist bypass would not establish it.

Consequently the normal repository build and stable lint rerun passed, but the
complete maintained unit route did not. Focused csvkit results do not establish
packed exports, public native-cleanup qualification or full compatibility.
The package README remains absent; README additions require separate user
permission. No Git delivery or release was authorized.
