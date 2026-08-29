# STR-02 independent validation

## Assignment and scope

Independent delegated validator, not author Avicenna. Assigned clone:
`/Users/kjopek/Workspace/poe-code-safejs-string-no-match`; frozen base:
`b7dfa47180e8e160bd40ca675b35073b9f422e5e`. Date: August 29, 2026.
Read workspace-parent and clone-root `AGENTS.md`; no additional applicable
instructions under SafeJS or docs.

Author manifest `out/safejs-remediation/str-02/manifest.json` SHA-256:
`e6392e45f2621a4469ea71ff3036dca5042c33b3620a79e5cc8da2903c6a6dc9`.
Verified all three working candidate files and their frozen author copies.
The production diff is exactly one line converting empty global `match` results
to null. No other string behavior is part of this patch.

No production changes, commits, pushes, README changes, security work, real LLM
calls, guest I/O, or other-clone writes. The STR-04 clone remains untouched and
not ready until its existing ARRAYOWN dependency is integrated and validated.

## Audit guard and original

Before any original payload read, bootstrapped the exact 38 exclusions from
`/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27/inventory-verification.json`
`archiveReadPolicy.excludedPaths`, plus the entire audit `security/` directory.
Metadata-order exclusion-list SHA-256:
`31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13`.
Only `strings/reductions/r06-no-global-match.safejs` is allowlisted. Checked its
canonical path, exclusion status, and absence of symlink indirection before
reading or hashing it. No original audit writes, recursive audit scans, excluded
reads/hashes/execution, or other original payload access.

The independent test embeds and hashes the complete unchanged source:

```text
const match = 'plain'.match(/\d+/g);
return { isNull: match === null, value: match };
```

Original SHA-256:
`5d7008596bfe91cbdf97d7486c854bd6f59b25a2edb131131aadb0032d505e3b`.
Native full result: `{ isNull: true, value: null }`.

## Independent design

- Execute native before SafeJS; assert the complete original result.
- Exercise all 16 combinations of supported `g`, `i`, `m`, `s` flags with absent,
  successful, captured, flag-sensitive, empty-input, and zero-width controls.
- Assert nullable data directly at the string-method boundary and test guest
  identity, truthiness, branch selection, numeric match contents, and fallback
  behavior. Guest numeric-content observations do not certify metadata access
  or key ordering; those remain separate failing qualification tests.
- Check neighboring no-match `matchAll`, `search`, `exec`, `test`, replacement,
  and split operations, repeated miss/hit/miss sequences, supported literal-string
  controls, and continued rejection of unsupported `y` and `gy` flags.
- Use a Vite test-only loader to replay the exact base `string.ts` blob in memory
  for RED; never replace working production files. Use current source for GREEN.
- Tests perform no filesystem writes and need no host modules. Bound guest
  execution to 5,000 steps. Structured cloning crosses intentional null-prototype
  objects without converting undefined, omitting data, or weakening assertions.
- Preserve synthetic metadata, STR-03, STR-04, and STR-05 native failures in
  separate ignored qualification tests. They are ordinary failing assertions,
  not skips or expected failures, and are not additional original audit reads.

## Execution record

Node `v22.22.2`, npm `10.9.7`. Evidence is under ignored
`out/safejs-remediation/str-02-validation/`; only this clone's `.git/info/exclude`
was extended. All source tests import current TypeScript, except explicit base
replays, whose loader substitutes the Git preimage entirely in memory.

| Check                                            | Independent result                                             | Evidence                                    |
| ------------------------------------------------ | -------------------------------------------------------------- | ------------------------------------------- |
| Independent RED on base                          | Exit 1; **45 failed / 144 passed**, 189 total                  | `red.log`, `red-results.json`               |
| Identical independent tests on candidate         | Exit 0; **189 passed**, no failures or skips                   | `green.log`, `green-results.json`           |
| Relevant broader suite                           | Exit 0; **334 passed**, 10 files, no skips                     | `broader.log`, `broader-results.json`       |
| Author tests, independent base replay            | Exit 1; **9 failed / 13 passed**, 22 total                     | `author-red-replay.log`                     |
| Author tests on candidate                        | **22 passed**, included in broader suite                       | `broader-results.json`                      |
| Author's five-file string/regex scope            | **99 passed**, included in broader suite                       | `broader-results.json`                      |
| Separate qualifications on base                  | Exit 1; **6 failed / 1 passed**, 7 total                       | `qualifications-base.log`, JSON report      |
| Separate qualifications on candidate             | Exit 1; **6 failed / 1 passed**, same cases                    | `qualifications-candidate.log`, JSON report |
| Workspace declaration/build tasks                | Exit 0; **67/67 successful**                                   | `build-workspaces.log`                      |
| Root types after workspace builds                | Exit 0                                                         | `root-types.log`                            |
| SafeJS configured package types                  | Exit 0                                                         | `package-types.log`                         |
| Independent and qualification test types         | Exit 0                                                         | `test-types.log`                            |
| SafeJS source and validator-config ESLint        | Exit 0                                                         | `eslint.log`                                |
| Five publishable paths, Prettier and diff checks | Exit 0                                                         | `format.log`, `diff-check.log`              |
| Exact original, native/source/built public core  | Full result equality; expected `{ isNull: true, value: null }` | `original-built-core.json`                  |

The independent test contains the unchanged original, 144 flag/pattern/input
cases checked at both method and guest boundaries, 32 neighboring-operation
controls, eight repeated miss/hit/miss sequences, two literal-string controls,
and two unsupported-flag rejections. Its GREEN test duration was 307 ms, 1.02
seconds including startup. No test timeout occurred. All 45 independent RED
failures are repaired by the single candidate line; no assertions were changed
between RED and GREEN.

Reproduction commands, run from the assigned clone:

```sh
./node_modules/.bin/vitest run packages/safejs/src/interp/methods/string.match-no-match.independent.test.ts --config out/safejs-remediation/str-02-validation/red.vitest.config.ts --reporter=dot
./node_modules/.bin/vitest run packages/safejs/src/interp/methods/string.match-no-match.independent.test.ts --reporter=dot
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error ./node_modules/.bin/vitest run packages/safejs/src/interp/methods packages/safejs/src/interp/regex packages/safejs/src/interp/globals/misc.test.ts --reporter=dot
./node_modules/.bin/vitest run out/safejs-remediation/str-02-validation/qualifications.test.ts --config out/safejs-remediation/str-02-validation/qualifications-base.vitest.config.ts --reporter=dot
./node_modules/.bin/vitest run out/safejs-remediation/str-02-validation/qualifications.test.ts --config out/safejs-remediation/str-02-validation/qualifications.vitest.config.ts --reporter=dot
env -u TERM ./node_modules/.bin/turbo run build --output-logs=errors-only
env -u TERM npm run lint:types
env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM ./node_modules/.bin/tsc -p out/safejs-remediation/str-02-validation/test-types.tsconfig.json --noEmit
env -u TERM ./node_modules/.bin/eslint packages/safejs/src out/safejs-remediation/str-02-validation/*.ts
```

Test setup rejects unmocked fetch/LLM calls; broader execution explicitly uses
snapshot playback/error mode and removes `TERM`. No full SafeJS or repository
test suite, security/adversarial suite, or LLM/e2e workflow was run here.
The author's **4,028 SafeJS passes / 39 skips** remain author-only evidence, not
independently rerun counts. Scoped GREEN must not be represented as a full-suite
GREEN.

## Preserved qualification failures

These independently authored bounded probes are separate ordinary assertions
against native, not original audit payloads or STR-02 acceptance assertions.
The same six probes fail on both base and candidate; no probe was skipped,
normalized to hide undefined, or marked expected failure:

- ARRAYOWN metadata access: `/a/.exec("a").index` is `undefined` in the guest,
  versus native `0`.
- Metadata own-key order: guest keys are `["0", "groups", "index", "input"]`,
  versus native `["0", "index", "input", "groups"]`.
- STR-03 numeric substitution: replacing `"a"` with `$10` using one capture
  returns `"$10"`, versus native `"a0"`.
- STR-03 context substitution: replacing `b` in `abc` using prefix/suffix tokens
  retains literal tokens, versus native `"aa-cc"`.
- STR-04 cursor state: `/a/g` initialized at 2 produces two matchAll results and
  retains cursor 2 after match, versus one result and final cursor 0 natively.
- STR-05 zero-width captured split: `"ab".split(/(a)?/)` yields
  `["", "a", "", undefined, "b", undefined]`, versus native `["", "a", "b"]`.

The simpler `"ab".split(/(a)|(b)/)` undefined-capture control passes on both
versions; it does not resolve STR-05. Initial five-failure/one-pass qualification
logs remain preserved as `qualifications-base-initial.log` and
`qualifications-candidate-initial.log`; adding the zero-width probe strengthened
coverage without removing or weakening the passing control or any failure.

## Readiness and dependencies

**Ready for scoped STR-02 handoff only.** Metadata/ARRAYOWN,
regex own-key order, STR-03 substitution tokens, STR-04 cursor state, and STR-05
undefined split captures remain independent unresolved qualifications. This is
not all-string parity, a full-audit pass, security certification, or release
approval. Existing unsupported regex flags and implicit string-pattern matching
remain outside the supported subset; no support is added here.

The frozen publishable set contains exactly these five paths:

- `packages/safejs/src/interp/methods/string.ts`
- `packages/safejs/src/interp/methods/string.match-no-match.test.ts`
- `docs/plans/safejs-fix-str-02.md`
- `packages/safejs/src/interp/methods/string.match-no-match.independent.test.ts`
- `docs/plans/safejs-validate-str-02.md`

Exact byte copies live under ignored
`out/safejs-remediation/str-02-validation/candidate/`. The existing production
preimage is copied under `preimages/`; the other four paths are absent at the
base, recorded explicitly rather than represented by empty files. The immutable
`manifest.json` records base/preimage Git blobs, preimage/final/capture SHA-256s,
author manifest identity, native original result, qualification failures, and
evidence hashes. Candidate files, preimage, and manifest are read-only and use
the macOS user-immutable flag.

Author files and frozen author copies remain byte-identical to the supplied
manifest. Root manifests/lock, regex implementation, parser, and array-member
implementation remain unchanged. No qualification tests, configs, logs,
generated build assets, or clone-local ignore changes belong in the publishable
set. Preserve qualification artifacts as failure evidence, not as a claim that
the full strings surface passes.

Any future three-way `string.ts` merge requires fresh independent merged
validation; never overwrite another approved change with a whole-file copy.
STR-04 remains not ready until ARRAYOWN integration and its independent rerun;
this STR-02 handoff changes neither its files nor its status. No CLI visual
change; screenshots do not apply. No commits, pushes, or publication occurred.
