# Independent review: exactly eight env shebang expectation migrations

Accepted **only this fixture migration**, independently replayed against committed
candidate **`5ba1a0f36e77c69b9ebb617c4d2544bf62d473a7`**. No product bug or
unauthorized input delta was found. This verifier is a separate leaf, not the
fixture author; it performed the work directly and did not delegate.

## Candidate and exact delta

The candidate parent is `bbb7f807f70c4db7014eee1f151a0ff51ee2a8a2`.
`audit.mjs` reconstructs the three complete candidate files from accepted original
`ea409a6b49d5c1523e3238f0384048218b559c4c` using an exact whitelist of the eight
expectation rows, title/loop separation, public error import, added namespace/file
assertions, and the two added errexit `finally` disposals. It requires byte-for-byte
equality of the resulting entire files, not just selected expressions. The three
original files also equal the candidate parent's versions. The candidate commit
changes exactly those three fixtures; no other test, product, package or config.

This proves retention of **all original headers, bodies, script bytes, mode 0755,
invocation/argv, cwd, env, filesystem setup, middleware and registration inputs**,
including all untouched scenarios in the host helper. The old four unsupported
non-env rows and the registered-bash override row retain their 126 assertions.
The core's `/work`, `/other`, env map, `report`/`emit` registrations, middleware,
original namespace assertion and `finally` are unchanged. Existing real
failing-command errexit tests are unchanged. No blanket 126-to-127 conversion or
diagnostic relaxation is permitted by the whitelist.

| Row | Original body (JSON string) | Revised observation |
| --- | --- | --- |
| core literal `env bash -e` | `"printf forbidden > marker\n"` | `[127,"","env: bash -e: command not found\n"]` |
| errexit literal `env bash -e` | `"printf BAD\n"` | `[127,"","env: bash -e: command not found\n"]` |
| errexit split `env -S bash -e` | `"printf BAD\n"` | `[0,"BAD",""]` |
| expanded literal `env bash -e` | `"printf forbidden"` | `[127,"","env: bash -e: command not found\n"]` |
| expanded split `env -S bash -e` | `"printf forbidden"` | `[0,"forbidden",""]` |
| expanded unregistered `env python` | `"printf forbidden"` | `[127,"","env: python: command not found\n"]` |
| expanded bare `env` | `"printf forbidden"` | actual `ShellLimitError`, `limit === "maxSubstitutionDepth"`; no returned tuple |
| expanded literal CR `env bash\r` | `"printf forbidden"` | `[127,"","env: bash\r: command not found\n"]` |

The `printf BAD` body contains **no failing command**; `BAD` output has no LF.
Every expanded body has no final LF; `forbidden` output has no LF. CR stays a real
byte in both header and diagnostic. Python remains unregistered in this setup;
this does not establish Python support or refusal of an explicit registration.

## Independent execution, not author-report repetition

Final capture: `candidate-5ba1a0f3-review2/`, August 27, 2026,
**16:15:09.215–16:15:20.738 UTC**, Node **v22.22.2**, Darwin arm64.
TypeScript **5.9.3**, tsx **4.23.12**, Node types **22.20.1**.

| Identical current product, different test expectations | Original unchanged | Revised candidate |
| --- | ---: | ---: |
| Entire `errexit-host.test.ts` | 28 pass / 2 fail / 30 | 30 pass / 0 fail / 30 |
| Entire `expanded-gaps-env-host.test.ts` | 1 pass / 5 fail / 6 | 6 pass / 0 fail / 6 |
| `resume-host.ts literal-single-optional-argument` | 0 pass / 1 fail / 1 | 1 pass / 0 fail / 1 |
| Combined selected cohort | **29 pass / 8 fail / 37** | **37 pass / 0 fail / 37** |

All TAP rows have zero skipped/cancelled/TODO. The only eight failures are the
authorized rows. The original bare-env failure is the thrown typed depth error,
not an assertion of a made-up result. `original-*.stdout` / `.stderr` retain exact
failures and stacks. Build and strict NodeNext checks of all three maintained
fixtures/transitive imports pass. The selected core child is **one** of its
helper's scenarios, not an independent replay of all 25 author scenarios.

Independent supplemental controls: **16/16**, separately counted, not new
canonical corpus rows. Eight use the original script/cwd/command inputs checked
against immutable original observation receipts. Four check unchanged unsupported
headers, two distinguish a real failing-command body under `-e` versus `+e`, and
two check bare-env depth limits 2 and 4. Bare-env default/2/4 recordings contain
129/5/9 middleware dispatches, respectively, and genuine public-class depth
rejections. Every row checks complete VFS root descendant names/types/modes/file
bytes before/after, including `/other` for core; none introduces file effects.
An explicit disposal observer runs once despite two `dispose()` calls, later
`exec` rejects as disposed, and namespace remains stable after disposal. This is
supplemental instrumented evidence, not an alteration of the untouched test replay.

Negative controls are separate: **8/8 input-whitelist mutations rejected**
(hidden `false`, body LF, argv, cwd, env, registration, blanket 127, trimmed CR),
plus **6/6 result-assertion mutations rejected**. These are assertion-sensitivity
checks, not six additional product executions or a mutation-testing claim over
the implementation. There were zero observed unhandled rejections.

## Source binding and reproducibility

The runner archives **all candidate `src`**, package/lock/build configs and the
three fixtures: **229 Git input paths**, including **226 product/build paths**.
It does **not** execute the old accepted product or overlay live product code.
Candidate source deliberately includes the intervening column/text/input changes;
`product-drift.diff` discloses all six changed/added source paths versus ea409a6b.
The unchanged env runtime hash alone is not treated as a whole-product binding.

Candidate tar SHA256:
`91d6073e8aeff4277ce33348b3a677963bc63d335b59d09c6c0caa440991d76a`.
The small archive is regenerated from Git, verified again after execution, and
not duplicated as a committed historical source archive. Every extracted input
is authenticated before execution. Only the three test files are temporarily
replaced with exact accepted originals in **owned scratch**, then restored;
the complete product source is identical for both runs.

| File | Original SHA256 | Candidate SHA256 |
| --- | --- | --- |
| `resume-host.ts` | `c22482b06a27a6883bf1d6f6dac98e8a83795495c452772869e3b5a03b3135ce` | `f3c490e84833227b6899d9ec6b37bfaa5de0b41ab6fabb3e84b531e29984f359` |
| `errexit-host.test.ts` | `5ba8085495c5740d4f15d413eb55502d270746f3e7275ef7aa6393500593cf7f` | `38a6372d6e518338a2379bef1b58cada12e5c06aceafc59b40e5afeda9fa2d36` |
| `expanded-gaps-env-host.test.ts` | `2fd1eb106e75ace5d17d7d5145045dab0f88aa254d4110862b2964fec61b5b95` | `d01394e6938cfc4758c6ee3c88a4f0660b0f6cf0aa2596a181ad71a26216628e` |

`report.json` contains exact executable/arguments/cwd/environment, timestamps,
deadlines, tool versions/selected tool hashes, all 229 input hashes, original test
hashes, and complete source/build censuses. Before/after censuses detect new or
removed regular files **and directories**, with unexpected symlinks rejected;
they do not compare metadata. The explicit root `node_modules` symlink is excluded
from source census, while generated `dist` is independently inventoried after
build and checked unchanged after all runs. Tool versions and six selected tool
files are bound, not the whole dependency tree or host OS. No dependencies install.

From repository root, using an unused label:

```sh
node tests/shell-stress/env-shebang-eight-migration-review/audit.mjs 5ba1a0f36e77c69b9ebb617c4d2544bf62d473a7
node tests/shell-stress/env-shebang-eight-migration-review/run.mjs 5ba1a0f36e77c69b9ebb617c4d2544bf62d473a7 fresh-review-label
node tests/shell-stress/env-shebang-eight-migration-review/verify-evidence.mjs
```

`run.mjs` requires the full committed candidate and its published marker, refuses
an existing output directory, and captures the marker before/after without editing
it. The last command verifies the retained review1/review2 evidence, not a fresh
label. The first command is read-only unless an unused audit output path is given.
The runner uses only owned scratch and a read-only preexisting tool symlink.
Each child has a **60-second** deadline and **4 MiB** combined-output cap, is in
an owned process group, and has a group-absence check/kill fallback. Environment is
explicit PATH `/usr/bin:/bin`, LANG/LC_ALL `C`, owned TMPDIR, disabled tsx cache.
Actual child commands are in `report.json`; the essential test commands are:

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell/errexit-host.test.ts
node --unhandled-rejections=strict --import tsx --test tests/shell/expanded-gaps-env-host.test.ts
node --unhandled-rejections=strict --import tsx tests/shell-stress/env-split-author/resume-host.ts literal-single-optional-argument
node node_modules/typescript/bin/tsc -p tsconfig.build.json
node --unhandled-rejections=strict controls.mjs
```

## Preserved defect, history and cleanup

`candidate-5ba1a0f3-review1/` is retained **as failed reviewer evidence**. Its
canonical old/revised counts and scoped typecheck already match review2; the
independent control incorrectly omitted `shell: line 1: ` from the exact
unsupported-header diagnostic. Its stderr, original harness bytes and hashes
remain. Only that control expectation gained the existing prefix; no candidate
code/fixture changed. Review2 reran the complete selected replay and controls.
This is a disclosed harness correction, not an undisclosed all-input pass or
relaxation of a product diagnostic. Data-only `.data`, `.stdout`, `.stderr`, and
`.diff` artifacts are outside canonical TypeScript discovery; no native capture
or golden file was created.

The full owned `git diff --cached --check` reports whitespace carried by raw TAP
assertion output and Git diff context lines. Those authenticated raw bytes are
deliberately preserved. The maintained harness, control source, documentation and
ignore file pass their separately scoped whitespace check; no formatting policy
or canonical test configuration was changed to hide the raw-artifact warnings.

`audit-before.json` / `audit-after.json` authenticate the same **118 historical
tracked files**, including original eight failure receipts and both prior evidence
families. This covers their bytes, not new untracked entries or metadata. The
original observation receipt still hashes to
`85ba9003214cb5c6f546dbea7997b24511c0c0c5edd3eae1f41cc55ae7c3af0a`.
Historical **30/30 semantic vs 17/23 strict native** is distinct from historical
**47/48 vs separately authorized 48/48**. Its profile remains
`Linux-optional-argv-model-GNU-env-on-Darwin`, **not actual Linux kernel**. No native
oracle ran here; the old bare-env 300 ms native nonsettlement is not a returned
status and receives no new pass credit.

Both owned scratch trees are removed; **18/18 owned child process groups** are
absent, rechecked by `verify-evidence.mjs`. Both runner sessions settled; no owned
worker/watcher remains. Other workers' files, staging, processes and native scratch
are untouched. The atomic evidence commit is restricted to this new directory;
the final CLI handoff records its commit and clean owned status.

No whole gate, complete helper cohort, all-TypeScript-fixture check, packed/public
consumer, deployed-provider, Linux-kernel, parity, superiority, performance or
72-hour-completion claim follows from this narrowly scoped migration review.
