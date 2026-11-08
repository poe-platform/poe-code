# Required-command preflight correction

This is an intentional test-only preflight delta, not a registry inventory update
or a source fix. The original `matrix.test.ts` is byte-identical. No expected CLI
bytes, mutation checks, typed filesystem assertions, provider policy, skips, or
workflow denominators changed. Exact complete registry membership remains Curie's
responsibility; this fixture requires the commands its workflows actually use.

## Inspection and requirements

The inspected fixture was clean in both index and worktree. It still matched
`33ddb70c75865e3e695cf471b942ab0add98a891`, rather than containing someone else's
pending preflight correction. Its two exact-set assertions compared
`createAgentCommands()` and the installed registry to the union of six factories.
That union had 49 names; the aggregate additionally installed `chmod`, `stat`,
and `mktemp` (52 names). This was not literally a numeric count assertion, but
the same brittle full-inventory assumption blocked all 79 workflow callbacks.

The replacement explicitly requires executable definitions for these 22 names:

| Family | Required workflow commands |
| --- | --- |
| Standard | `cat`, `cp`, `find`, `mkdir`, `mv`, `printf`, `pwd`, `rm`, `rmdir`, `sort`, `tee`, `test`, `touch`, `xargs` |
| Text programs | `sed`, `awk` |
| Structured | `jq` |
| Search | `rg` |
| Bytes | `sha256sum`, `gzip` |
| Diff/patch | `diff`, `patch` |

This includes every external command in the common coding-agent flow, not one
representative per family, plus the other matrix operations. Shell syntax and
builtins (`:`, `set`, `cd`, `exit`) are not registry requirements. The deliberately
unknown command remains absent from the required list. Initialization now also
asserts that `:` succeeds with empty output and stderr.

Preflight checks existence and callable execution, not feature flags or claimed
semantics. The unchanged 79 workflows remain the relevant behavioral capability
gate: named-file reads; `xargs` nested invocation; pipes and redirection; supplied
and empty stdin; binary compression/checksums; exact diff/patch bytes; namespace
mutations; cancellation and limits. It does not require optional streaming,
permissions, timestamps, or atomic-rename flags to be true, hide failures behind
capability skips, or claim registration proves these behaviors work.

`withFixture` still defaults to real root `agentCommands()`. Only the separate
control tests supply its new optional plugin parameter. Production workflows
receive no substitute commands or changed plugin options.

## Frozen paired evidence

Captured at **2026-08-27T00:21:57.692Z** (August 26 in America/Chicago), based on
HEAD **`7d0fe7b45578cfc3836e9a8d6a5fd4a4d5e9edd3` plus dirty worktree inputs**.
This is not a clean-HEAD gate and does not attribute concurrent command fixes to
the preflight patch. All production source, the WebDAV mock, package/configuration
inputs, and selected tests were copied to regular files inside this owned tree.
The complete selected-input manifest matched before and after copying. Both
matrix runs and the controls used those same frozen production bytes. Frozen
inputs matched before and after each subprocess; live selected inputs also
matched at the final observation. Later changes are not covered by this seal.

| Identity | SHA-256 |
| --- | --- |
| Frozen `src/**` manifest | `bb7d5784a69dbf44e4aaf967bc19e4579966ea69e95705a338ccb71dc2aeef4d` |
| Old-preflight selected inputs | `ad7cc01e91030ea14f788eb5a887330dc69478aba5a7ec3348c6552c364ac73a` |
| Required-preflight selected inputs | `582258aec47e433eddf51d44037f9d8f0b75f4915a174c32b3bb490da5d1a8f4` |
| Old fixture bytes | `59ac2d1835ff329d0bbd08e3ae28bc8c656145e5bb568e6dbca0e851367cb3ab` |
| New fixture bytes | `127a6910a2733d6b6df01285d37d5c90ccbeeeefda40e0869dc633ef8f6d14e5` |

Manifest hashes are SHA-256 over `JSON.stringify` of path-sorted
`{path,bytes,sha256}` entries; the source hash selects only `src/` entries.
`evidence/inputs.json` provides individual hashes and environment versions.
The old run differed only in `fixtures.ts`; the new preflight module and control
test were present but unused in the old matrix run. `fixture-before.txt`,
`fixture-after.txt`, and `fixture.diff` retain the exact intentional fixture delta.
`source-dirty.diff`, `untracked-source.json`, and the checkpoint identify the
captured source changes, including the concurrent core filesystem/move work;
these are evidence copies, not source changes made by this task. Untracked
archive source was captured for identity completeness, not exercised or reviewed.

| Cohort | Tests | Pass | Fail | Exit |
| --- | ---: | ---: | ---: | ---: |
| Old preflight, complete unchanged workflow matrix | 79 | 0 | 79 | 1 |
| Required-command preflight, complete unchanged workflow matrix | 79 | 77 | 2 | 1 |
| Separate preflight controls | 30 | 30 | 0 | 0 |
| Strict scoped TypeScript check, including controls | n/a | n/a | 0 diagnostics | 0 |

Every test run has **0 skipped, 0 TODO, 0 cancelled**. The two 79-case executions
are paired cohorts, not 158 unique workflows. Controls are separately counted,
not added to the workflow denominator. The old raw failures all stop at the
aggregate factory equality assertion; the new run really executes the workflows.

Required-preflight backend subtotals: memory **11/11**, real **11/11**, S3
**10/11**, WebDAV **10/11**, mount **12/12**, overlay **12/12**, readonly **10/10**,
standalone jq split **1/1**. Required four-backend subtotal: **42/44**. All six
writable common coding-agent flows pass, but the complete adapter gate is red.

The two preserved failures are `create, copy, append, inspect and remove files`:

- S3: `rmdir: ENOTSUP: S3 object deletion cannot atomically require an empty directory prefix, rmdir '/work/scratch/nested'`.
- WebDAV: `rmdir: ENOTSUP: rmdir has no safe portable WebDAV equivalent, rmdir '/work/scratch/nested'`.

Both reach the existing success assertion with exit 1 instead of 0. These are
real safe-empty-directory capability limitations, not preflight failures or
allowed exceptions. The test still requires success and exact final namespace
effects. No recursive-delete approximation, assertion weakening, backend
capability waiver, or source remediation is included.

## Negative controls and reproduction

The 30 controls comprise **22 individual required-command omissions**, **six
whole-family omissions**, **one absent aggregate plugin**, and **one extra
unrelated executable command**. All 29 omissions must reject actual `withFixture`
setup with the precise missing-command assertion and must not enter its workflow
callback. Whole-family controls remove every definition delivered by that family,
not just a representative. The extra-command control installs the real aggregate
plus `adapter_tools_unrelated`, reaches the callback, executes that command and
`cat old.txt`, and checks both dispatches. The raw TAP and exact assertions are
retained; successful negative-control tests mean rejection worked, not that an
incomplete registry was accepted.

Normal focused commands:

```sh
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/matrix.test.ts
node --unhandled-rejections=strict --import tsx --test --test-reporter=tap tests/integration/adapter-tools/preflight-review/preflight.test.ts
```

`run.mjs` creates a new regular-copy freeze, runs both complete matrices, the
controls and the scoped typecheck, captures raw stdout/stderr and individual
process statuses, then removes only its own temporary snapshot. Recorded argv,
timings, input hashes and exit codes are in `evidence/*.result.json`. The retained
cohort was generated with `node tests/integration/adapter-tools/preflight-review/run.mjs`.
To capture a later **separate current-input** cohort without overwriting it:

```sh
node tests/integration/adapter-tools/preflight-review/run.mjs evidence-next
```

The capture script's exit is not the matrix gate; inspect each recorded process
status. It deliberately retains nonzero matrix results rather than treating
successful evidence collection as passing interoperability. Tool versions and
dependency manifest hashes are recorded, but installed dependency trees are
shared with the root and are not an independently frozen dependency environment.

## Historical boundaries and handoff

The original **71/79** diagnostic cohort, revised **77/79** cohort, earlier
**79/79** append-boundary checkpoint, and other historical observations in the
parent README remain separate; none is relabeled by this run. In particular,
Dirac's audit commit **`96db59a`**, frozen dirty **`57d9d986`**, still records
**9,686 pass / 164 fail / 70 skip** across 9,920 tests, including the 79 blocked
adapter workflows. This narrow fresh 77/79 result neither repairs that audit
retroactively nor constitutes a new whole-repository test result.

No full-repository tests, new backend breadth, foreign diagnostics edits, source
edits, or independent identity-review edits were performed. Dirac's independent
review of this new preflight delta remains pending. Registry exact-set audits
remain with Curie; remote `rmdir` limitations remain visible for their owners.
