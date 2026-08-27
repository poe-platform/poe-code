# Eight env-shebang expectation migrations: author evidence

This is test-only author evidence, not independent reviewer acceptance. The fixture
commit is `5ba1a0f36e77c69b9ebb617c4d2544bf62d473a7`; its exact parent is
`bbb7f807f70c4db7014eee1f151a0ff51ee2a8a2`. That commit changes only:

- `tests/shell-stress/env-split-author/resume-host.ts`
- `tests/shell/errexit-host.test.ts`
- `tests/shell/expanded-gaps-env-host.test.ts`

The separate evidence commit adds this directory only. No production, package,
root config, other test, dependency, or historical receipt is changed here.
The requested reviewer handoff is `/tmp/env-eight-migration-author-candidate.txt`.

## Literal inputs and exact changes

Actual original and candidate TypeScript ASTs yield the same eight headers, write
paths, script bytes, executable modes, and exec call expressions. See
`comparison.json.fixtureInputs`, including base64 and SHA256. All bodies were
inspected before authorizing edits and then mechanically checked: only
`printf forbidden > marker\n`, `printf BAD\n`, or `printf forbidden`. None hides
a failing command, conditional, or suppressed failure. These two `-S` bodies are
not errexit-stop witnesses. No `false` was inserted or removed.

All old rows asserted status 126. The exact replacements are below; strings use
JSON escapes, so `\r` represents a real CR and `\n` represents LF.

| Row | Exact header | New status / rejection | stdout | stderr |
| --- | --- | --- | --- | --- |
| core-literal | `#!/usr/bin/env bash -e` | 127 | `""` | `"env: bash -e: command not found\n"` |
| errexit-1 | `#!/usr/bin/env bash -e` | 127 | `""` | `"env: bash -e: command not found\n"` |
| errexit-2 | `#!/usr/bin/env -S bash -e` | 0 | `"BAD"` | `""` |
| expanded-1 | `#!/usr/bin/env bash -e` | 127 | `""` | `"env: bash -e: command not found\n"` |
| expanded-2 | `#!/usr/bin/env -S bash -e` | 0 | `"forbidden"` | `""` |
| expanded-3 | `#!/usr/bin/env python` | 127 | `""` | `"env: python: command not found\n"` |
| expanded-4 | `#!/usr/bin/env` | public `ShellLimitError`, `limit === "maxSubstitutionDepth"` | not returned | not returned |
| expanded-5 | `#!/usr/bin/env bash\r` | 127 | `""` | `"env: bash\r: command not found\n"` |

Neither successful stdout has a trailing LF. The five expanded scripts have no
final LF; the core and two errexit scripts retain theirs. Core still runs
`./script` in `/work` with `/other`, its exact exported env, middleware, `report`
and `emit` registrations. The other seven still run `/script` in `/` with their
original Shell/agentCommands setup and no additional env/argv/limits.

The original core namespace assertion remains. All eight now check unchanged
script bytes and directory entries. Existing finally disposal remains; the two
separated errexit rows additionally dispose in finally. Four non-env unsupported
headers still expect 126 with their original assertions. Existing failing-command
errexit controls, permission/UTF8/switch refusals and reserved-bash override
refusal remain unchanged. The python case proves only an unregistered name in
this setup. Bare-env asserts an actual rejection, not an invented exit tuple.

## Exact-source execution

`original-c800c899/` executes Git archive
`c800c899114c6c83b3d3eb67231176d124abaf49`; `candidate-5ba1a0f3/` executes the
fixture candidate archive. Original selected inputs equal the candidate parent's
selected inputs byte-for-byte; intervening commits contain AGENTS/unrelated
evidence only. `comparison.json` verifies that binding and that only the three
fixtures differ across the two source inventories. No live product overlay.

| Selected cohort | Original | Candidate |
| --- | --- | --- |
| Two canonical host files | 29/36, seven failures | 36/36 |
| Original resume-host scenarios, direct bounded runs | 24/25, literal-single-optional-argument fails | 25/25 |
| Unchanged `env-shebang.test.ts` controls | 29/29 | 29/29 |
| Isolated build | exit 0 | exit 0 |
| Strict owned fixtures/transitive imports | exit 0 | exit 0 |

TAP cohorts have zero skips, cancellations or TODOs. Both sets of supplemental
eight observations are identical, including exact output bytes, typed rejection,
unchanged script/namespace, and disposal. `probe.mjs.data` discloses this separate
observer: it reconstructs literal inputs and relevant host setup, catches the
bare-env rejection to continue, and disposes all shells. It does not replace
execution of the original assertions. Original failure logs remain alongside
passing candidate logs. No production bug was found in these scoped observations.

From repository root, explicit opt-in capture with new lowercase labels:

```sh
node tests/shell-stress/env-shebang-eight-migration-author/capture.mjs c800c899114c6c83b3d3eb67231176d124abaf49 original-new-label
node tests/shell-stress/env-shebang-eight-migration-author/capture.mjs 5ba1a0f36e77c69b9ebb617c4d2544bf62d473a7 candidate-new-label
```

Existing output directories are refused. `capture.mjs` records exact command
arrays, absolute executable/cwd/env, archive hashes, all 231 selected input file
hashes, tools and process receipts in each `report.json`. It archives all `src`,
package/lock/build configs, the three fixtures, `env-shebang.test.ts` and its
helper; then links existing node_modules for read-only use. No install.

Source execution uses Node `v22.22.2`, Darwin arm64, tsx `4.23.12`, TypeScript
`5.9.3`, @types/node `22.20.1`, esbuild `0.28.2`. Tool package manifest hashes are
recorded, not a seal of every installed tool byte. Environment is exactly
`PATH=/usr/bin:/bin`, `LANG=C`, `LC_ALL=C`, `TMPDIR=<owned scratch>/tmp`,
`TSX_DISABLE_CACHE=1`; product fixture env remains independently unchanged.

Exact test/build/typecheck invocations from the isolated source cwd:

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 --test-reporter=tap tests/shell/errexit-host.test.ts tests/shell/expanded-gaps-env-host.test.ts
node --unhandled-rejections=strict --import tsx tests/shell-stress/env-split-author/resume-host.ts SCENARIO
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 --test-reporter=tap tests/shell/env-shebang.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node node_modules/typescript/bin/tsc --noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck --types node tests/shell-stress/env-split-author/resume-host.ts tests/shell/errexit-host.test.ts tests/shell/expanded-gaps-env-host.test.ts
```

All 25 original resume scenario names are derived from the unchanged dispatcher
and recorded individually. They run directly, not through the outer
`env-split-host.test.ts` wrapper. Each has a 6000ms deadline; other commands have
30000ms deadlines. Combined output is capped at 4MiB per child. These explicit
strict flags check owned fixtures/transitive imports, not all TypeScript fixtures
or maintained consumers. Product execution uses source/tsx, not built dist.

## Integrity, history and limits

Before/after inventories compare every source regular-file key/hash and directory
entry, reject unexpected symlinks, and detect new entries. Only root `dist` and
`node_modules` are excluded; this is not metadata preservation or a dist/tool seal.
Both ephemeral archives/build trees/tool links are removed. All 31 command PIDs
and process groups per capture are absent; `comparison.json` separately rechecks
all 62. No test/native/watch worker remains. Only owned scratch was removed.

The current source is NOT historical `ea409a6b`: its runtime/env files match, but
column/text and `src/shell/input.ts` differ; exact changed paths and hashes are
in each report. This candidate's new scoped source execution is not a relabeling
of old-source acceptance.

`comparison.json.history` reauthenticates 17 existing receipt files against the
original Git revision, without editing them. Preserve separately:

- Original eight failures and observations in
  `../env-shebang-integration-review/guarded-ea409a6b-20260827-review1-controls/`.
- Historical frozen semantic **30/30** versus strict native **17/23** in
  `../env-shebang-integration-review/guarded-ea409a6b-20260827-review1/`.
- Original guarded author **47/48**, and separately authorized `f6a3fa75`
  overlay **48/48** in `../env-shebang-integration-review/expectation-f6a3fa75/`.

Historical bare-env native 300ms SIGKILL/nonsettlement is not a settled exit,
pass, or Linux equivalence. No native recapture occurred. GNU env/Bash-on-Darwin
historical modeling is not actual Linux kernel qualification. No new native raw
data is introduced; probe source is `.mjs.data`, outside TS/test discovery, and
these `.mjs` drivers are opt-in, not canonical tests.

No independent acceptance, whole gate, packed/public-consumer qualification,
deployed-provider proof, universal parity, superiority, performance or 72-hour
completion is claimed. A different reviewer must freeze and accept the exact
fixture candidate independently.
