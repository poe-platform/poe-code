# Node24 actual four-body replay — independent bounded result

**45/45 actual TAP tests pass; four unchanged files; zero failures, skips,
cancellations or TODOs.** This executes the test bodies, not a name-filtered
bootstrap. It does not establish a whole-product gate or universal SafeJS parity.

This is a separate evidence revision beside the sealed `loader-null-source-review`
folder so89a09a31, its Node22.22.2 failures and the bootstrap-only results remain
byte-unchanged and their original verifier still passes. No Curie gate file,
product source, existing fixture, root config or private source was modified.

## Actual results

Executed August27,2026,15:10:27–15:10:38 UTC from product commit
`8670ebe8f0d39966c2de2638780437398e5f8490`:

| Unchanged candidate path | Pass / tests | Skip / cancel |
| --- | --- | --- |
| `tests/commands/metadata-stress/mktemp-controls.test.ts` | 7/7 | 0/0 |
| `tests/commands/metadata-stress/permission-profile-independent/review.test.ts` | 7/7 | 0/0 |
| `tests/commands/safejs/local-safejs.test.ts` | 25/25 | 0/0 |
| `tests/integrations/safejs/local-safejs.test.ts` | 6/6 | 0/0 |

The25 command tests include seven generated host-escape denials and four generated
quota cases. Counts also include the unchanged in-memory public-type probes and
permission-fixture historical authentication/control tests; they are not45
distinct interpreter features. Actual engine workflows cover shared VFS/cwd/env,
pipelines, multibyte/binary input, console/result output, cancellation, quotas,
replay policy and isolation, exactly as the original bodies assert.

All four direct commands are equivalent to:

```sh
/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node --import tsx --test --test-reporter=tap --test-concurrency=1 EXACT_CANDIDATE_TEST_PATH
```

There is **no test-name filter, skip override, body substitution or expectation
delta**. Each stdout/stderr/TAP accounting and exact argv is retained in
`attempt-1/RESULT.json` and its per-file logs. Tests ran serially; this does not
claim a new concurrency2 full-gate run. No assertion or native dialect difference
was observed in these four files on this explicit profile.

## Runtime and loaded-input binding

- Executing Node: installed24.11.1, Darwin arm64; no installation/download.
- Binary SHA256:
  `4255a388254ca4319e2f95f1da375d5deaddf25baf9c7c85070b67f9543b15d0`.
- Unchanged external guard SHA256:
  `af4608b333f6b2dc4384fb28d3866a134ba3efc0a120d63a9adeee79f0f21114`.
- All314 regular-copy tool files match originald98b8321 gate receipts:
  tsx4.23.12, TypeScript5.9.3, esbuild0.28.2, @types/node22.20.1.
- All529 selected source/test/config inputs are authenticated against8670 Git
  blobs; no live product overlay or dist fallback. Source-load guard receipts
  remain active throughout real test execution.
- GNU mktemp9.7 Darwin binary SHA256:
  `47c9a287d363308748124c29dfd2e8f84e821a25d8279c042a54d8a4f0806d1d`.
  It is the original mandatory profile binary copied to the expected isolated
  `.oracle` location. Its `/bin/bash` wrapper remains Apple Bash, with C/UTC;
  there is no GNU/Linux claim or substitution of all49 native tools.
- The permission review's real `git show` calls use198 explicitly selected
  historical objects in independent local Git metadata (two committed metadata
  trees/package inputs and traversal trees). No alternates, linked worktree,
  remote, live index or `METADATA_HELPER_COPY` override. Both original historical
  revisions and raw seal assertions run unchanged.

`NODE_OPTIONS` retains the original guard preload and adds only a passive runtime
receipt preload, not another resolve/load hook. Each actual test child records
its pid, argv, execArgv, `process.execPath`, real executable path/hash/version,
cwd, frozen source and copied SafeJS root. The verifier checks the test child's
entry argv and matches its pid to the supervisor observation. Duplicate receipts
with the same pid are not counted as separate child processes. Parent launchers
and native/esbuild subprocess observations are also retained. The unused npm
tool-root allowance is narrowed to an empty list for these direct-Node commands;
PATH selects24.11.1. Neither change disables the guard.

## Actual private engine and preservation

Actual engine0.0.1 from private HEAD
`bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e` was copied as264 independent regular
files, matching the exact original gate engine manifest. Tree SHA256:
`e1bbb8110c1b917f3ef78df2e7594a4a7b89e3851bc0903e247f78d1b80148fb`.
Execution uses only that owned copy. No private worktree, symlink, build,
installation, proposal patch or private-source execution occurred.

Private HEAD, full `git status --porcelain=v1`, index hash and selected engine
file census are identical before/after. Existing private user edits/untracked
files remain untouched. The census detects changed/missing/new regular engine
files in the copied selection; as in the original gate it excludes
`node_modules`, `.git`, `dist`, `.cache`, `.turbo`. This is not an all-ignored-file
or empty-private-directory immutability claim.

The owned source tree, staged tools/native inputs and local metadata are checked
after every file and after controls against the pre-execution file/directory
inventory: bytes, modes, missing paths **and new entries**. Before/after tree hash
is `74e0435060d2590129eaeb4d3dc865f1a17bb6bc76e7162c6c26c4633460df00`.
The copied engine's file census also remains unchanged. No private source bytes
are retained in this evidence; only identities/manifests and test output.

## Guard controls and remaining qualification

All with the **same unchanged guard** and Node24.11.1:

- Valid critical source imports succeed, exit0.
- A temporary mutation to the copied `src/commands/env-split.ts` rejects with
  exit1 and the specific `Frozen env source bytes` diagnostic; restored afterward.
- A harmless module outside the allowed root rejects with exit1 and
  `FROZEN_IMPORT_OUTSIDE`, before its marker body executes; removed afterward.

Each phase/control closes cleanly without timeout, forced signal or survivors.
The exact owned scratch tree, tools, private-engine copy and outside sentinel are
removed. No network service, whole suite or product build ran. The original two
TypeScript compiler probes run in-memory as required by their unchanged bodies;
this is not a standalone global/build typing claim.

Node22.22.2 failures remain preserved. Node22.22.3 was **not tested**. Curie's
separate new runtime-qualification/preflight patch has not been handed off or
reviewed here: this report does not certify its exit78 behavior, change the
product engine minimum, or authorize a whole-suite launch. Root must relay that
patch for its independent review.

## Reproduction

```sh
node tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/run.mjs /tmp/NEW-EXCLUSIVE-ACTUAL-BODY-CAPTURE
node tests/integration/full-gate-20260827/loader-null-source-review-node24-bodies/verify.mjs
```

The first is an explicit real-engine four-file replay requiring the already
installed runtime/tool/native/private-input hashes. It never installs or builds
the private package. The second verifies sealed evidence without reading the
private checkout or executing test bodies. `MANIFEST.json` binds this revision.
