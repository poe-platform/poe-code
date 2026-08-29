# STR-05 independent typed split validation

## Assignment and isolation

Independent delegated validator, not author Hume. Date: August 29, 2026.
Workspace `/Users/kjopek/Workspace/poe-code-safejs-split-captures`, frozen base
`33c73a21fb01875b0e2297ccac955974a0889991`, already includes STR-03. Read parent
workspace and clone-root `AGENTS.md`; no nested instructions apply to SafeJS or
docs. No production changes, commits, pushes, security research, real LLM calls,
README edits, or other-clone writes. Previous STR-02/STR-04 clones stay unchanged.

Author manifest `out/safejs-remediation/str-05/manifest.json` SHA-256:
`f66baa09664a072a66f9de345205ee065dd9e4217a0fd6d82c5ea15e14756739`.
All three owned files and their frozen copies match. The production diff is six
added/two removed lines in split assembly; no replacement, parser, regex-state,
or metadata change is proposed.

## Audit guard and originals

Before original payload reads, bootstrapped exactly 38 exclusions from
`/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27/inventory-verification.json`
`archiveReadPolicy.excludedPaths`, plus the entire audit `security/` directory.
Exclusion-list SHA-256 in metadata order:
`31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13`.
The explicit functional allowlist is the two identified string examples
`01-marked-table.safejs`, `06-template-replacement-unicode.safejs` and reductions
`r01`, `r03`, `r04`, `r05`, `r06`, `r07`, `r08`, `r09`, with full paths and hashes
recorded in ignored `original-inventory.json`. Each path is checked against the
exclusions, security subtree, and symlink indirection before read or copy.
No recursive audit scans, excluded reads/hashes/execution, or original writes.

All ten original workflows are kept byte-identical. Native runs use only a
function wrapper for their top-level return, not adapted source. Complete
outputs are compared strictly after prototype normalization by structured clone;
undefined, empty strings, null, holes, lengths, and own-key ordering in returned
key arrays are not normalized away. Preserve readable typed inspection and V8
serialization, not JSON-only evidence.

STR-05 original `r07-zero-width-split.safejs` SHA-256:
`9ec3190d87f38c9087ee5fd5610420319153e1d86b3a90bfe476f35396e7def1`.
All five native fields are required:

```text
{
  empty: [],
  characters: ['a', 'b'],
  captured: ['a', 'b', ''],
  bounded: ['a', '1', 'b', '2'],
  astralCodeUnits: [55358, 56810]
}
```

## Root cause and author RED history

The original defect is a spurious zero-width terminal capture slot, not coercion
of a legitimate undefined capture to an empty string. The base returns an extra
fourth own `undefined` in `captured`; legitimate own undefined captures already
work and must remain distinct from empty strings and holes. The fix skips
zero-width separators at the already-consumed position and terminal boundary,
and retains the proper trailing input segment.

Inspected author `failure-history.md`, `red.log`, `red-corrected.log`, and
`baseline-original.log`. Initial RED was 11 failed / 31 passed, including a
native-realm/null-prototype comparison mistake. Corrected/extended RED was
13 failed / 36 passed, with production still on its preimage. The baseline typed
log explicitly confirms the extra fourth own undefined and already-working
genuine undefined controls. Keep initial failures and formatting/wrapper
corrections visible; do not recast them as product regressions or an audit
excluded-payload incident.

## Independent test design

- Byte-hash the unchanged original and require its full five-field native result.
- Native-oracle split matrix over all 16 supported `g`, `i`, `m`, `s` combinations,
  empty/nonempty inputs, zero-width/consuming/nested captures, UTF-16 units,
  integer/undefined limits, and preserved separator cursor state.
- Assert exact lengths and keys, every own slot, and strict element identity at
  direct-method and guest boundaries. Explicitly distinguish dense own undefined
  from a hole, empty string, and null; verify lossless V8 round-tripping.
- Check literal empty/undefined/omitted separators and preserve upstream STR-03
  numeric, unmatched, and context substitutions.
- Keep unsupported `u`, `y`, `gy`, `gu`, `d`, `v` rejected. General limit coercion,
  Unicode/sticky support, exotic inputs, and performance claims are out of scope.
- Replay the exact Git preimage through a test-only Vite loader for RED, without
  changing production. All unit tests are in-memory, without filesystem writes
  or real host modules; fixture tests only read explicitly staged originals.
- Keep complete original failures as separate ordinary assertions, never skipped
  or marked expected failure. They qualify scope rather than claim all-string
  parity.

## Execution record

Node `v22.22.2`, npm `10.9.7`. Evidence root:
`out/safejs-remediation/str-05-validation/`, locally ignored through this clone's
`.git/info/exclude`. No shared ignore configuration changes.

| Independent check                                   | Result                                                        | Evidence                                    |
| --------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------- |
| New test, exact base loader                         | Exit 1; **186 failed / 627 passed**, 813 total                | `red.log`, `red-results.json`               |
| Identical new test, current candidate               | Exit 0; **813 passed**, no skips                              | `green.log`, `green-results.json`           |
| Broader methods/regex suites                        | Exit 0; **1,137 passed**, 11 files, no skips                  | `broader.log`, `broader-results.json`       |
| Final author test, independent base replay          | Exit 1; **13 failed / 36 passed**, 49 total                   | `author-red-replay.log`                     |
| Final author test, candidate                        | **49 passed**, included in broader                            | `broader-results.json`                      |
| Author's original broader scope                     | **324 passed**, included in broader                           | `broader-results.json`                      |
| All ten original workflows, base                    | Exit 1; **5 failed / 5 passed**                               | `originals-base.log`, JSON report           |
| Same unchanged originals, candidate                 | Exit 1; **4 failed / 6 passed**                               | `originals-candidate.log`, JSON report      |
| Typed original replay through source and built core | Six exact / four qualified, all ten source/core outputs equal | `originals-typed.v8`, `originals-typed.log` |
| Author typed evidence cross-check                   | All ten native and actual outputs independently confirmed     | `originals-typed-summary.json`              |
| Workspace builds/declarations                       | Exit 0; **67/67 successful**, before root types               | `build-workspaces.log`                      |
| Configured package/root types                       | Exit 0                                                        | `package-types.log`, `root-types.log`       |
| Independent test and original-replay types          | Exit 0                                                        | `test-types.log`                            |
| SafeJS source and validation-config ESLint          | Exit 0                                                        | `eslint.log`                                |
| Five publishable paths, Prettier; diff check        | Exit 0                                                        | `format.log`, `diff-check.log`              |

The 813 independent tests comprise 768 flag/input/pattern/limit cases tested at
both method and guest boundaries, 36 literal separator controls, six unsupported
flag checks, the complete original, explicit own-undefined/hole/empty controls,
and an omitted-separator/upstream-STR03 sentinel. All 186 RED failures are repaired
without changing the test bytes. GREEN ran in 1.59 seconds total, 846 ms in tests;
broader coverage ran in 2.31 seconds total, 1.11 seconds in tests. No timeout.
Both upstream `string-replacement.test.ts` and
`string-replacement-validation.test.ts` pass in the broader run.

The existing build was retained, then workspace declaration/build tasks were
successfully rerun before root types. No full SafeJS, full repository,
security/adversarial, live-provider, or e2e suite was independently run. The
author's **4,216 SafeJS passes / 39 skips** and **21,601 repository passes / 41
skips** remain author-only counts, not independent full-suite claims. Broader
execution removes `TERM` and explicitly sets snapshot playback/error; repository
test setup rejects unmocked fetch and LLM calls.

Reproduction commands from the assigned clone:

```sh
node_modules/.bin/vitest run packages/safejs/src/interp/methods/string-split.independent.test.ts --config out/safejs-remediation/str-05-validation/red.vitest.config.ts --reporter=dot
node_modules/.bin/vitest run packages/safejs/src/interp/methods/string-split.independent.test.ts --reporter=dot
env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error node_modules/.bin/vitest run packages/safejs/src/interp/methods packages/safejs/src/interp/regex --reporter=dot
node_modules/.bin/vitest run out/safejs-remediation/str-05-validation/originals.test.ts --config out/safejs-remediation/str-05-validation/originals-base.vitest.config.ts --reporter=dot
node_modules/.bin/vitest run out/safejs-remediation/str-05-validation/originals.test.ts --config out/safejs-remediation/str-05-validation/originals.vitest.config.ts --reporter=dot
env -u TERM node_modules/.bin/turbo run build --output-logs=errors-only
env -u TERM npm run lint:types
env -u TERM node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM node_modules/.bin/tsc -p out/safejs-remediation/str-05-validation/test-types.tsconfig.json --noEmit
env -u TERM node_modules/.bin/eslint packages/safejs/src out/safejs-remediation/str-05-validation/*.ts
```

## Complete original results and limits

All ten originals were independently inspected before bounded execution and
copied unchanged under `originals/`. Each replay verifies the source hash. Native
and SafeJS receive exactly the same source, without field removal, callback
rewrites, index substitutions, or metadata adapters. Original tests retain strict
full-output assertions, including all four remaining failures as ordinary red
tests. They are not skipped, marked expected failure, or counted as scoped GREEN.

| Original                                 | Full candidate result                                             |
| ---------------------------------------- | ----------------------------------------------------------------- |
| `01-marked-table.safejs`                 | Exact native parity                                               |
| `06-template-replacement-unicode.safejs` | Qualified: missing guest match metadata offsets remain            |
| `r01-match-metadata.safejs`              | Qualified: guest metadata access and returned key ordering remain |
| `r03-replacement-captures.safejs`        | Exact native parity; upstream STR-03 retained                     |
| `r04-replacement-context.safejs`         | Exact native parity; upstream STR-03 retained                     |
| `r05-global-lastindex.safejs`            | Qualified: STR-04 cursor behavior remains                         |
| `r06-no-global-match.safejs`             | Qualified: STR-02 still returns `[]` instead of null in this base |
| `r07-zero-width-split.safejs`            | Exact native parity in all five fields                            |
| `r08-unicode-and-anchors.safejs`         | Exact native parity for the unchanged supported-flags workflow    |
| `r09-repeated-captures.safejs`           | Exact native parity                                               |

`originals-typed.v8` stores complete native/source/built-core results and explicit
slot controls. `originals-typed.log` renders them without collapsing undefined
or holes. The JSON summary records only status and provenance, not a substitute
for typed equality. V8 round-trip assertions prove that a genuine own undefined
remains own undefined and an intentionally constructed hole remains absent.
The original's removed fourth slot is absent; valid unmatched capture slots
remain dense own properties, never replaced by empty strings or null.

The original STR-05 native output is exactly the five-field object above. The
separate synthetic `"xaZ".split(/a(b)?/)` control remains `["x", undefined, "Z"]`;
`"xaZ".split(/a(b*)/)` remains `["x", "", "Z"]`. Source and built core both pass.

## Readiness and handoff

**Ready for scoped STR-05 handoff only; upstream STR-03 remains green.**
STR-01/metadata, STR-02, STR-04, and regex own-key ordering remain separate
pending qualifications. No all-string, full-audit, security, or release approval.
Future three-way `string.ts` merges require fresh independent merged validation.

Freeze exactly these five publishable paths under ignored
`out/safejs-remediation/str-05-validation/candidate/`:

- `packages/safejs/src/interp/methods/string.ts`
- `packages/safejs/src/interp/methods/string-split.test.ts`
- `docs/plans/safejs-fix-str-05.md`
- `packages/safejs/src/interp/methods/string-split.independent.test.ts`
- `docs/plans/safejs-validate-str-05.md`

The production preimage is copied under `preimages/`; the other four paths are
explicitly recorded as absent at base. Candidate files, preimage and external
manifest use read-only permissions and macOS user-immutable flags. The manifest
records exact byte hashes, base Git blobs, author identity and retained RED
history, original hashes and typed evidence, checks, and remaining dependencies.
Its own SHA-256 is reported externally to avoid a self-hash cycle.

Author files and frozen author copies remain unchanged. No logs, diagnostic tests,
original fixtures, generated build assets, or clone-local ignore edits belong
in the publishable set. No CLI visual changes; screenshots are not applicable.
No production edits, commits, pushes, prior-clone writes, or publication occurred.
Future three-way merges must use recorded preimages and obtain fresh independent
validation of the merged string behavior, including upstream STR-03.
