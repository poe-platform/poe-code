# Executed command receipt

Historical command record only, not authorization to rerun. Cwd for every command:
`/Users/kjopek/Workspace/safe-bash`. The only controlled Node argv/exit/raw stderr
is in ATTEMPT.json. No second Node invocation or harness fix followed it.

Metadata command argv are recorded below. Each SELECTED entry means, in order,
the exact15 path strings in BINDINGS.json.selectedSource, expanded as separate argv
members after `--`; this is a lossless argument-list reference, not a glob or
dynamic source selection. Git path arguments have no shell wildcard expansion.

| Command argv | Observed result |
|---|---|
| `git rev-parse --show-toplevel` | exact repository root |
| `git status --short` | unrelated work present, preserved |
| `git diff --cached --name-status` | empty at initial, freeze and postcohort inspections |
| `git rev-parse <revision>^{commit}` for 43777899,2ae74702,adcb1467,26de751f,f5e9fc49b6abb38e180cc9de16c95fced102ff75,c23a8de855f4f51423ee21c35ef5bbcc4d2d56a5,cd9d08be0918ddc5bd59c40b088e06be2b5b2f54,682aad1292eac3dc82a2c15a48b9f0c6ec9c5628 | full values in BINDINGS |
| `git show -s --format=%H %cI %s bc60e57b 43777899 2ae74702 adcb1467 26de751f` | freeze later than both author cohorts; timestamps inspected |
| `git diff --exit-code 437778996f60109e212e20b1b242455866fda285 -- SELECTED` | exit0, no output |
| `git ls-tree -r 437778996f60109e212e20b1b242455866fda285 -- SELECTED` | all15 recorded blobs/mode100644 |
| `git diff --name-status 43777899^ 43777899` | exactly15 modified paths, matching SELECTED |

Exact frozen input comparison, exit0/no output:

```sh
git diff --exit-code f5e9fc49b6abb38e180cc9de16c95fced102ff75 -- tests/commands/search-stress/harness.ts tests/commands/search-stress/pipelines.test.ts tests/commands/table-text-stress/frozen-corpus.json
```

Exact protected live comparisons, each exit0/no output:

```sh
git diff --exit-code 2ae74702 -- tests/integration/full-gate-20260827/unified76-driver/r3-repair-v1
git diff --exit-code 26de751f -- tests/integration/full-gate-20260827/unified76-driver/r3-tool-closure-v1
git diff --exit-code 682aad12 -- tests/integration/full-gate-20260827/unified76-driver-independent/r3-diagnosis-v19
git diff --exit-code cd9d08be -- tests/integration/full-gate-20260827/unified76-driver/r3-diagnosis-v1
git status --porcelain --untracked-files=all -- tests/integration/full-gate-20260827/unified76-driver/r3-repair-v1 tests/integration/full-gate-20260827/unified76-driver/r3-tool-closure-v1 tests/integration/full-gate-20260827/unified76-driver-independent/r3-diagnosis-v19 tests/integration/full-gate-20260827/unified76-driver/r3-diagnosis-v1
```

Exact protected committed tree query; matches all5 historical tree IDs in BINDINGS:

```sh
git ls-tree HEAD tests/integration/full-gate-20260827/unified76-driver/r3-repair-v1 tests/integration/full-gate-20260827/unified76-driver/r3-tool-closure-v1 tests/integration/full-gate-20260827/unified76-driver-independent/r3-diagnosis-v19 tests/integration/full-gate-20260827/unified76-driver/r3-diagnosis-v1 tests/integration/full-gate-20260827/unified76-driver/released-run-v3-qualified-h11
```

The f5 and source437 root `src`, package, lock, README and tsconfig tree entries
were inspected with `git ls-tree <revision> -- src package.json package-lock.json
tsconfig.json tsconfig.build.json README.md`; source437 is not the f5 product tree.
This is not a native capture census, actual tool identity check or114MB rehash.
Source bodies/diffs were inspected with finite cat/sed/nl/git show commands;
none of those imports or executes the subject module. All authored files use
apply_patch. Commits use explicit individual owned paths and
`git -c core.hooksPath=/dev/null commit --only`; no broad staging or branch creation.
