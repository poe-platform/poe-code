# env shebang implementation author report

## Candidate and ownership

- Candidate: `dc262a99da8910d082ce7051e811952639588209`.
- Author writes began only after ROOT's marker authorized frozen independent review
  commit `5339b1e75ecda072adffed689da21943235b9192`. The bounded gate poll exited;
  no production/test writes or mutating tests preceded authorization.
- Candidate paths: `src/shell/runtime.ts`, `tests/shell/env-shebang.test.ts`,
  `tests/shell/env-shebang-host.test.ts`. Source ownership remained restricted to
  imports, `Runtime.scriptFile`, `Runtime.interpreter`, and private shebang helpers.
- `/tmp/safe-bash-env-shebang-author-candidate.txt` was published immediately after
  the coherent source/regression commit so ROOT could schedule unchanged replay.
- Independent fixtures, reviewer implementation, native references and results
  were not inspected. This report is author evidence, not independent review.

## Implementation boundary

The private bridge obtains the existing `executionCommands` env definition once.
It forwards the entire optional header suffix as one argument and appends the
literal script/user argv. The actual env handler retains splitting, environment
expansion timing, assignments, clearing/unsetting, cwd preparation and diagnostics.
Its replacement invoke callback accepts only reserved `bash` and `sh`; it does
not consult functions, virtual PATH, host PATH, registered env, or a general
executor. A registered bash/sh override is refused with 126, not invoked. Other
selected command names return 127 with `env: NAME: command not found`.

The bridge preserves the interpreter's complete argv, including alternate source,
`-c`, `-s`, `-e`, `+e` and `--` selection. The original charged source is reused
only for the same resolved virtual pathname. Other selected files/strings/stdin
are charged by the existing interpreter. Explicit interpreter reads treat env
headers as comments, avoiding recursion; other interpreter-path validation stays
unchanged. The process state is isolated with the env-selected cwd. This is not
a file identity lease or transactional protection against host mutation.

One command-budget tick accounts for the reserved interpreter dispatch; argv
field count and per-field byte limits match literal dispatch bounds. Existing
process-state depth admission, source/output/loop budgets and invocation cleanup
remain shared. Interpreter errors are rethrown outside env's utility-error wrapper
so shell statuses and abort identity are not converted to generic env failures.
The env handler await is interruptible and observes late rejections.

No new public API, dependency, Shell/Budget, product subprocess/host filesystem
access, normal executor/discovery/invoke change, direct env/plugin change,
contract/export/package change, private package change or ownedOutput change.

## Validation and qualification

Recorded on August 27, 2026; candidate commit timestamp 14:54:16 UTC. Capture folder
`capture-20260827T1500` is an identifier, not a claim about exact execution time.
Tools: Node 22.22.2, npm 10.9.7, TypeScript 5.9.3. Captures are from the live dirty
checkout, not an immutable archive. Concurrent foreign product changes included
column and text sources; owned source/test hashes were stable for the final runs.
The moved built consumer also uses that live build, not a clean archived package.
`live-status.txt` and `pre-candidate-head.txt` preserve this qualification.

| Check | Result | Capture |
| --- | --- | --- |
| New author tests | 29/29, zero skips | `capture-20260827T1500/author.tap` |
| Existing env core/invoke tests | 125/126; one stale refusal | `capture-20260827T1500/core.tap` |
| Existing script/interpreter/errexit tests | 203/210; seven stale refusals | `capture-20260827T1500/scripts.tap` |
| `npm run build` | exit 0 | `capture-20260827T1500/build.log` |
| `npm run typecheck` | exit 2, unrelated inventory gate | `capture-20260827T1500/typecheck.log` |
| Scoped strict source/author-test TypeScript | exit 0 | `capture-20260827T1500/scoped-typecheck.log` |
| Owned diff whitespace | exit 0 | checked before candidate commit |

Author count comprises 18 integration tests, eight bounded isolated host probes,
one relocated built public-package consumer and two pinned native-profile groups.
Coverage includes literal argv, environment timing, cwd/source selection, parser
errors/caps, flags, permission/binary/syntax refusals and no partial syntax effects,
registry/function hijacks, binary pipelines and descriptors, unread input,
provenance, source/command/output/depth/loop/argv limits, preabort/parser/input/sink/
cwd cancellation, cooperative cleanup, cleanup-failure identity and late rejection.

Commands, in order:

```sh
node --import tsx --test tests/shell/env-shebang.test.ts tests/shell/env-shebang-host.test.ts
node --import tsx --test tests/shell/env-split-native.test.ts tests/shell/env-split-host.test.ts tests/shell/env-split-limits.test.ts tests/shell/env-replacement.test.ts tests/shell/invoke.test.ts
node --import tsx --test tests/shell/script-entrypoint.test.ts tests/shell/invocation-modes.test.ts tests/shell/errexit-host.test.ts tests/shell/expanded-gaps-env-host.test.ts
npm run build
npm run typecheck
node node_modules/typescript/bin/tsc --noEmit --strict --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node src/shell/runtime.ts tests/shell/env-shebang.test.ts tests/shell/env-shebang-host.test.ts
```

The repository typecheck gate reports three unclassified current `.mts` inputs:
`tests/commands/grep-aliases-stress/verification/holdouts.mts`,
`tests/commands/grep-aliases-stress/verification/public-consumer.mts`, and
`tests/commands/grep-aliases/consumer.mts`. None was changed, waived or excluded.
Scoped checking is not a replacement for the blocked repository qualification.

## Existing stale conflicts: retained, not waived

All eight failures assert the previous blanket 126 refusal. No unexpected runtime
regression appeared in these scoped controls; this is not a full-suite assertion.

| Existing location | Header | Actual / historical expected status |
| --- | --- | --- |
| `tests/shell-stress/env-split-author/resume-host.ts:94` via env-split-host | `env bash -e` | 127 / 126 |
| `tests/shell/errexit-host.test.ts:131` | `env bash -e` | 127 / 126 |
| same | `env -S bash -e` | 0 / 126 |
| `tests/shell/expanded-gaps-env-host.test.ts:7` | `env bash -e` | 127 / 126 |
| same | `env -S bash -e` | 0 / 126 |
| same | `env python` | 127 / 126 |
| same | bare `env` | 127 / 126 |
| same | `env bash\r` | 127 / 126 |

All headers above retain `/usr/bin/` before `env`. Non-S packed bytes remain one
missing command. Supported S fixtures now execute. Missing/unsupported reserved
names remain unexecuted, but use explicit env selection status 127. The existing
registry-override refusal control still passes. ROOT must route historical test
reconciliation separately; no existing fixture or diagnostic assertion was edited.

## Native controls and historical partitions

Native binaries are authenticated against the existing
`tests/shell-stress/env-split-author/native-frozen.json` SHA-256 pins before use.
GNU env 9.7 / GNU Bash 5.3 and Apple env / Apple Bash 3.2 are separate Darwin-hosted
profiles. Each validates an exact successful single-optional `-S ... -c ...` raw
status/stdout/stderr tuple and a non-S packed command's 127/empty-stdout failure
(stderr only required nonempty, not claimed GNU diagnostic parity). The Apple
profile separately executes a real Darwin kernel shebang, retaining the known
packed non-S divergence: native status 1/stdout `before`, virtual status 127/empty.
These are not Linux deployment or broad GNU parity evidence.

Primary reference consulted for the single-optional protocol:
`https://www.gnu.org/s/coreutils/manual/html_node/env-invocation.html`.
Current online documentation was not substituted for the pinned native versions.

Historical accepted core 7/7, revised hidden hosts 7/7, GNU 39/42 strict plus
three separate diagnostics, five GNU single-optional protocol losses and three
Darwin packed protocol losses remain historical partitions. No old evidence was
rewritten or reclassified. Whole8670 remains immutable and unqualified by this
work. No superiority, full-suite, universal parity or 72-hour-completion claim.

## Initial author fixture defects preserved

The first integration run was 12/16. Four author test defects were corrected,
not product workarounds: `--split-string bash` was incorrectly expected to split
as a long option inside one optional argument (actual usage status 2); malformed
quote diagnostics expected `unterminated` instead of the handler's exact
`no terminating quote in -S string`; identical output bytes were compared as
Uint8Array versus Buffer prototypes; and a provenance test assumed `/dev/null`
existed in the minimal fixture. The corrected tests explicitly cover the invalid
long-option form, use the actual specific diagnostic, compare Buffer bytes, and
create a virtual `/empty` fixture. The next integration run was 16/16.

The first combined host/native run was 26/27. Its original native source was:

```text
printf '<%s><%s><%s><%s>' "$0" "$#" "$2" "$3"
```

It was embedded in `-S bash -c 'SOURCE' fixed`, creating invalid nested single
quotes. Both virtual and GNU produced syntax status 2, accidentally satisfying
tuple equality; Apple exposed its unrelated syntax line 0 versus virtual line 1.
That original input is retained here as an author oracle-fixture defect, not a
parity pass. The correction uses double quotes around the printf format and adds
explicit success status 0 and exact `<fixed><3><><a b>` assertions before native
comparison. The corrected combined run was 27/27; two further substantive limit/
source-accounting tests brought the final cohort to 29/29. No diagnostic relaxation
or production change was used to make the invalid native fixture pass.

## Cleanup

Every owned test subprocess has a kill deadline and a bounded output buffer;
completed children are checked with an ESRCH liveness assertion. Host probes wait
for their scheduled late rejections, clear timers and dispose shells. Temporary
native and moved-consumer directories are removed in finally. Final inspection
found no owned temporary directories or running probe/native/consumer children.
The only matching coordinator command lines were this leaf's own Codex parents,
which were not killed. The gate poll and all validation commands have exited.
