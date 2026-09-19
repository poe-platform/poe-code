# SQL literal conversion and cleanup qualification

This continuation preserves the existing fourteen-name TypeScript ESM suite
and optional safe-bash registration. It does not complete csvkit compatibility.
The target archive remains SHA-256
`147318a8dbaec07c0bbb9291c14b78de5fa32ed3d4a5c2396e52a83c0a30df6b`;
the existing source authentication/profile records are retained unchanged.

## Original reference and reproduced failures

The available reference was authenticated as CPython 3.14.2, csvkit 2.2.0,
Agate 1.14.2, SQLAlchemy 2.0.54 and Babel 2.18.0. Original small inputs call
the released `csvkit.cli.parse_list` and its actual `ast.literal_eval` algorithm.
Native CLI observations use that exact interpreter and released executable
scripts with explicit C/UTC/UTF-8 environment, 80 columns and 24 lines. No
native command or Python runtime participates in product execution or unit
discovery. Captures are in `sql-unhashable-reference.json` and
`sql-key-identity-reference.json`.

The first original regression suite failed 30 of 40 tests: unhashable Python
containers returned status 78, eager conversion hid fallback/exception ordering,
and CLI/SDK routes consequently reported the wrong status and diagnostic.
After separating syntax parsing from conversion, the original supported cases
passed; two historical TypeError refusal assertions and their dedicated test
were upgraded to exact Python exception expectations, preserving their frozen
source observations. Additional original multiline inputs failed nine of 91
tests before the blanket multiline-exception refusal was narrowed to SyntaxError.

The final cohort has 38 parser observations: 35 exact qualified cases and three
explicit grammar/line-diagnostic refusals. It also has 47 exact native CLI
stdout/stderr/status observations. Six CLI/SDK host-contract tests compare
database acquisition, no query dispatch and exactly-once rollback/close.
They do not qualify a real driver/query engine.

An independent agent then reproduced numeric-string dictionary reordering and
merging of distinct Python surrogate-codepoint keys. Its 21 in-memory tests
initially had nine failures. Nested dictionaries with canonical JavaScript
array-index string keys now use the existing Map representation; ordinary
string-key records and the top-level public option Record are preserved.
Six surrogate escape refusal assertions remain excluded from parity claims.
Top-level arbitrary numeric option-name enumeration remains a documented limit.

## Independent registered-tool review

A different agent reproduced synchronous/asynchronous zero-row csvlook probe
close failures rejecting `shell.exec` after the engine had already emitted its
normal diagnostic. Both original regressions failed before the fix. Registered
cleanup now drains the same idempotent close without reporting the already
awaited failure twice. Three new tests pass, including delayed acquisition and
failed close during cancellation, exact caller-reason preservation and reusable
Shell invocation. The focused lifecycle cohort passes 33/33 cases.

The new registered test is asserted by its exact literal path in the maintained
integration-input discovery test. Domain tests remain within the package's
maintained src declarations. Public exports/consumer contracts are unchanged.

## Verification

The combined final new domain regression files pass 112/112 tests, including
explicit refusal/host-contract assertions; this is not a parity denominator.
The SQL-focused cohort before the final independent additions passes 248/248.
The maintained safe-bash selected build closure passes eleven declared tasks.
Maintained discovery/runner tests pass 109/109; affected rebuilt SQL/lifecycle
Shell tests pass 38/38. Maintained safe-bash typecheck passes source/tests and
all 26 current consumer groups with expected negative-consumer rejection.
Maintained domain lint passes ESLint and product/test typechecks.

An ad hoc screenshot renders the actual registered sql2csv TypeError/status.
Visual inspection confirms readable command, complete diagnostic and status
without clipping. It is not a screenshot test or terminal certification.
`git diff --check` passes. Temporary owned logs/screenshot are reduced into this
record and removed; pre-existing output artifacts are preserved.

The final maintained domain unit route passes 93 files and 4,345 tests, with one
skip/five TODOs excluded. The final selected domain build closure passes four
declared tasks. The final rebuilt affected Shell cohort passes 38/38, and the
final maintained safe-bash typecheck passes all 26 consumer groups. Root
`npm run lint` completes successfully: guarded ESLint has zero errors/two
warnings outside csvkit, maintained root/contract type lint and workflow lint
pass. These are current worktree checks, not committed/packed release proof.

The normal repository `npm test` completed with exit 1; its detailed outcome is
recorded below. Existing suite blockers in
`implementation-status.md` and the individual specifications remain open.
No README, staging, commit, push or publication is authorized or performed.

## Broad-run argument-admission correction

The broad safe-bash phase reproduced two current canonical test failures in
`tests/commands/csvkit-stress.test.ts`. An isolated original-name run reproduced
both: old assertions expected binding-level RangeError and prohibited all sink
writes. The already documented shared-engine admission contract returns
`{exitCode: 78}`, empty stdout and exactly
`csvkit: unsupported or unqualified: argv count limit exceeded\n` or
`csvkit: unsupported or unqualified: argv byte limit exceeded\n` on stderr.
The standalone OwnedArguments constructor still throws RangeError; that is a
different public boundary, not the registered command execution contract.

The canonical expectations now assert the complete returned object and exact
channel text while retaining zero copy reservations and forbidden stdin
acquisition. No product behavior was changed for this correction. An initial
correction incorrectly expected a bare numeric status and failed both cases;
the corrected registered-command result shape then passed the entire 72-test
file without skips/TODOs. The original broad run retains its two failures; the
later focused pass is reported separately rather than relabeling that run.
The final maintained safe-bash typecheck passes after this correction.

## Full-run failures and independent dependency investigation

The maintained uncached `npm test` run completed, rather than being terminated
or replaced with a root-only route. Its safe-bash runner checks pass 536/536;
discovery selects 1,265 TypeScript files. That workspace reports 42,496 tests:
41,646 pass, 26 fail, 824 skip, zero TODO and zero cancelled. The earlier shared
unit phase passes; it predates the final independent domain regression file,
which is covered by the separately completed 93-file domain run above.

Two of the 26 failures are the argument-admission assertions corrected and
verified separately above. Two are committed-archive/packed-export gates:
`committed Pandoc build metadata is authenticated with the source archive` and
`S3 HTTP root/subpath exports work from a clean packed revision without source
fallback`. An isolated original-name archive run reproduces
`committed build input differs from reviewed authority: scripts/build.mjs`.
These checks inspect the committed candidate at HEAD. The existing build and
archive-control edits are preserved; the authenticated authority is not loosened,
and no commit is authorized. Current worktree builds do not clear these gates.

The other 22 failures are setup failures in
`tests/shell/invocation-cleanup-public.test.ts` with the same diagnostic:
`Unadmitted peer public route: @e965/xlsx`. An isolated original-name run and
the different agent's independent investigation reproduce the rejection before
any cleanup scenario executes. These cases are blocked, not measured cleanup
failures or passes.

The existing authenticated `bindPeerArtifact` API admits only public poe-code
routes and selected built files below packages/*/dist/*. Its private binding
identity cannot be forged, and checkout/artifact/io options do not provide an
external-dependency binding channel. Faithful admission requires a separate
bounded external profile: exact importer/specifier/target edges, pinned package
metadata and lock identities, selected runtime files with size/hash bounds, and
corresponding staging and public-worker edge verification. The measured closure
is @e965/xlsx 0.20.3 (`xlsx.mjs`, `dist/cpexcel.full.mjs`), saxes 6.0.0
(`saxes.js`) and xmlchars 2.2.0 (three XML modules); the shared office-package
boundary must remain authenticated. A blanket bare-import allowlist, bypassed
runtime binding or omitted public consumers would not qualify it. SQLite uses
injected engines and adds no WASM loader/binary to this inspected closure.

The dependency investigation is read-only; no guard, authority, staging or
worker protocol was changed. This authenticated-profile extension remains an
integration blocker. The full run retains exit 1 and all 26 recorded failures;
later scoped corrections are not substituted for a full-gate pass. The separate
maintained root posttest lint-stress route passes 2/2, and final guarded ESLint
again completes with exit 0 after the argument test correction.
