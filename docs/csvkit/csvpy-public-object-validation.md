# csvpy public object bridge validation

Recorded September 18, 2026. This is a scoped implementation/qualification record, not completion of full csvkit/Agate compatibility.

## Reference acquisition and census

Authenticated csvkit 2.2.0 archive SHA-256 `147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b` and Agate 1.14.2 archive SHA-256 `7f29841c39d84b1de7fde762b8d792085371515324f3a01413b20f810398225b` before source inspection. All 100 installed Agate Python source files in the reference environment matched the authenticated archive. CPython 3.14.2's executable hash matches the existing frozen profile. The native cohort uses the recorded minimal `C`/UTC environment and pinned Agate/Babel/SQLAlchemy versions. Existing reference profiles and source manifests are preserved.

`csvpy-public-object-census.json` records nine namespaces, 270 immediate public entries, 61 Agate classes, 2,207 public/inherited/protocol member records, source signatures and hashes, config defaults, and representative preloaded/returned object types. Every complete-API qualification remains BLOCKED. Imports of public foreign modules, dynamic plugins and arbitrary method return values extend the namespace beyond this finite census and remain explicit blockers. `csvkit.cli` does not install Excel/DBF/SQL Table extensions in this source path; their installed versions record reference provenance only.

`csvpy-object-reference.json` contains seven injected non-TTY `code.interact` reference captures. Five selected transcripts are compared exactly by canonical tests. The field-error traceback and typed-table captures are reference-only blockers, never product passes. An initial native capture failed because one case changed the process-global CSV field limit; the corrected acquisition resets that limit between cases. An initial Table print escaped stdout redirection because its default stream was bound at import; the corrected capture explicitly supplies the captured stream. Neither defective capture is counted as qualification.

## Original failing regressions and changes

- Guest mutation of Reader.line_numbers previously had no effect. Source-defined guest methods now prepend header/physical row numbers and honor later header mutation.
- Reader lacked raw-reader/dialect forwarding and allowed assignment to line_num. It now exposes a guest raw iterator and read-only properties; dialect attribute values and assignment errors match the selected native transcript.
- Agate canonical CSV/exception modules, config aliases/default locale and exception inheritance were missing/wrong. The bridge now supplies scoped modules, native-shaped exception constructors and the frozen locale's en_US_POSIX. PythonSession's new owned-module alias capability retains module identity, rejects foreign/unregistered handles and replacement, and remains metered/session-local.
- Numeric CSV conversion incorrectly raised guest Error. It now raises ValueError through actual interpreter evaluation.
- The stdlib csv module was incorrectly named _csv and the source CSV namespace lacked its csv reference and delimiter list. These identities/objects are now installed as scoped guest values. A later native differential reproduced the fabricated public agate.csv.Error export; it was removed in favor of the actual csv.Error access path.
- An earlier source-derived regression expected successful blank-row skips to retain the initial skipped-line counter. Native CPython 3.14.2 and inspected 3.9.6 getters update line_num on every fieldnames access. The original incorrect assertion remains documented as history; corrected regressions cover successful rows, blank-only tails, subsequent fieldnames access and header reset ordering.

All new product changes followed failing original/differential cases. No native interpreter, filesystem creation, network/LLMs or real database is used by the new canonical tests. Guest expressions, imports, suites, functions, generators and printing run through PythonSession, not a JS expression matcher. The registered command uses the same engine as the SDK.

## Passing checks

- Final `npm test --workspace=@poe-code/csvkit`: 87 files passed, 4,127 tests passed, one skipped and six TODO. Skipped/TODO cases are not passes. The csvpy file contains 24 passing tests, including five exact frozen transcripts.
- Final selected `npm run build:workspaces -- --workspace=@poe-code/csvkit`: maintained four-workspace build closure passed, including safe-python. The broader safe-bash maintained build closure passed earlier with 11 build tasks; subsequent csvkit-only namespace changes rebuilt its actual dependent library without changing safe-bash source or exports.
- Final `npm run lint --workspace=@poe-code/csvkit`: ESLint, production types and test types passed.
- `npm test --workspace=@poe-code/safe-python -- src/session-object-bridge.test.ts src/session-interactive.test.ts src/session.test.ts --maxWorkers=1`: final retry passed all 29 tests across three files. An intervening attempt timed out on one interactive syntax case while broader checks were active; that failed attempt is not a pass.
- A different agent's final rebuilt registered-command review passed 28 tests, zero skips/TODOs/failures. It checks exact channels/status, VFS effects, iterator/generator exhaustion, duplicate/missing/extra dictionary cells, mutability/read-only diagnostics, canonical imports, config isolation and exactly-once close. ESLint passed both changed registered stress/user-edge files.
- Integration discovery/runner regressions: 109 passed, no skips/TODOs. The new registered-command test is asserted by its exact literal path.
- Guarded root ESLint, root lint:types and root lint:workflows passed. The root ESLint observation preceded the final private CSV-error namespace correction; final package lint covers that correction. These observations are separate from a completed root unit gate.
- An ad hoc screenshot of the actual registered console was generated with the maintained screenshot utility and visually inspected: banner, echoed input, prompts, numbered rows, config printing and EOF appear correctly. This is not a screenshot test or live TTY/IPython certification.
- git diff --check passed. No staging, commits, push, publication or README edits were performed.

## Unresolved broad gate

Two uncached root npm test attempts entered the maintained declaration-derived build/unit route and were interrupted after validated failures. Neither completed or passed; remaining workspace phases were not measured.

The first attempt timed out at 5,000 ms on EUC-KR split-pair strict leading byte 146 and a DOCX maximum paragraph-identity case. The full maintained EUC-KR file passed independently (1,058 tests), and the DOCX case passed in 418 ms (other filtered cases were not counted). A serial-local Vitest scheduling experiment preserved CI's two-worker setting, membership, cases and timeouts, but the retry still timed out on ISO-2022-JP-2 designation ESC $ @ / lead 153, EUC-KR strict leading byte 131 and a native-list descriptor case. The scheduling experiment was ineffective and its configuration change was restored; it is not part of the delivered change.

Independent investigation found the ISO case's invalid lead takes an immediate, metered strict-error path. The exact case passed in 9 ms; the entire maintained ISO file passed all 8,128 tests in 21.52 seconds. These isolated successes do not clear the aggregate failures. Resource/scheduling interruption is a hypothesis, not an established cause. Aggregate timeout failures remain unresolved validation blockers; no timeouts were raised, tests removed/quarantined or unavailable cases counted as passes.

## Remaining compatibility blockers

`../specs/csvpy-public-object-contract.md` enumerates the blocked Table/Row/Column/MappedSequence/TableSet, type/Decimal/temporal, aggregation/computation, warning/utility, construction/CSV/stdlib, reader post-error recovery, traceback/console and optional IPython surfaces. Table mode still refuses a missing qualified injected library with status 78. Native table observations and parser support are not guest Agate support. Full arbitrary Python/Agate interaction and CPython 3.9.6 differential qualification remain incomplete.

This task's temporary captures, extracted source, scripts, logs and screenshot under out are purged after recording these observations. Unrelated existing output artifacts are preserved.
