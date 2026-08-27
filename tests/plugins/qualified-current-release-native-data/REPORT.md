# Exact native-data configuration handoff

August 27, 2026. Narrow leaf author, no delegation. **The native-data separation
is implemented; global typing remains failed, and no product/release/cleanup
acceptance is claimed.** Independent verification must start after actual author
exit, not infer CLOSED from this document.

## Ownership and change

Initial HEAD was `c652d99cbd71252da5c6165579bba063d2d6d319`. All owned paths were
staged/unstaged clean and the index was empty. Foreign untracked artifacts and
later concurrent index/source/test changes were preserved. This patch changes
only the exact root exclusion entry, the actual `package.json` test discovery
script, narrow README/ledger qualifications, and this new owned directory.
No source, producer, fixture, API, root index, other compiler configuration,
dependency, rootdist, private runtime or protected reviewer content was edited.

`tsconfig.json` adds exactly
`tests/commands/regex-execution/continuation/artifacts/native`, preserving every
existing include, compiler option and exclusion. The actual previous test runner
was `node --import tsx --test "tests/**/*.test.ts"`; it would execute future data
named `*.test.ts`. The replacement uses Node's existing builtin `globSync` with
the same pattern and an equality-only directory exclusion, then starts the same
Node/tsx test runner with the selected argv. It adds no framework/dependency,
preserves argument boundaries (including spaces/Unicode) and forwarded arguments,
and fails rather than falling back to implicit discovery if selection is empty.

Direct user invocations naming native files are not prohibited; this is default
discovery/source classification, not a host-code sandbox. Other artifact paths
remain eligible, including six already present ignored copied tests. The new
inline launcher was exercised on Node v22.22.2, Darwin arm64; no other OS/runtime
matrix is claimed. `test:contracts` and other package scripts are unchanged.

## Full subtree classification

`classification.json` lists all **72 files** with exact path, length and SHA-256:

- **22 raw payloads** in ten `dialect-*` directories. Every byte sequence is
  `hit` followed by LF. Each directory's complete filename set matches a recorded
  case from `continuation/dialect-evidence.json`; `continuation/dialect.mjs`
  explicitly makes this native scratch directory and writes those bytes before
  invoking the filename-selection oracle. The producer source, evidence and
  recorded profile are hash-bound. Classification is not an extension guess.
- **50 generated tsx JSON transform caches**, with `code`, `warnings`, and `map`
  fields and source maps pointing to canonical source/test paths outside the
  excluded directory. These generated copies are not maintained source/helpers.
- No unknown entries, symlinks or maintained source/test/helper files are accepted
  by the classification capture. The user explicitly classifies the six `.ts`
  diagnostics as immutable native glob data; no attribution from timestamps or
  authority to change producer files is inferred.

The six exact paths relative to the excluded subtree are:

```text
dialect-bFUsLx/alpha.ts
dialect-bFUsLx/beta.ts
dialect-uhGVu3/ab.ts
dialect-uhGVu3/🙂.ts
dialect-xj7h8F/a.ts
dialect-xj7h8F/d.ts
```

All six remain four bytes and have SHA-256
`74a02f560cc1d8e023280b5f08a1ee7266e4bec6cea61ca457dc1a758d080fc8` in every before
and after capture. All 72 manifest entries are likewise unchanged across these
captures. Original fixtures were only read; canaries exist only in owned
temporary copies, cleaned by their creator. The regular regression test reads
the committed classification manifest, not ignored original files, so a fresh
checkout does not require recreating historical native artifacts.

## Actual current global gate

Toolchain: Node v22.22.2, npm10.9.7, TypeScript5.9.3, Darwin arm64. Each capture
runs real `npm run typecheck` (`tsc --noEmit`) between two actual
`node node_modules/typescript/bin/tsc --noEmit --listFilesOnly --pretty false`
censuses. No historical typing pass/failure is substituted for these commands.

| Evidence | UTC gate time | Gate exit | Snapshot qualification |
| --- | --- | --- | --- |
| `before.json` | 08:37:26–08:37:35 | 2 | HEAD c652d99c; source stable; one concurrent canonical test appeared; wrapper exited1 on census-stability assertion |
| `before-02.json` | 08:38:13–08:38:23 | 2 | HEAD2542cfa2; source/test bytes changed concurrently; wrapper exited1 on stability assertion |
| `after.json` | 08:42:05–08:42:16 | 2 | HEAD9f7fed68 with this author's uncommitted config/tests; all recorded head/source/test/config/native/program/index bindings stable during the gate |

Both original failures contain **14 diagnostics**: the six exact native
TS2304 `(1,1) Cannot find name 'hit'` records plus eight foreign TS2307/TS7006
errors under `tests/commands/filesystem-inspection-stress/tree/sealed/inputs/`.
The latter affect `src__contracts__{command,filesystem,io,path,plugin}.ts` and
are retained byte-for-byte in the post-fix output. **After the correction only
those eight remain.** No foreign error was fixed, suppressed or excluded.

These before/after records are not a frozen identical-source causal experiment:
the second baseline raced another owner's `src/commands/file/{README.md,classify.ts}`
and `tests/commands/file/{fixtures.ts,native.test.ts}` edits. The isolated controls
below supply matched-copy evidence for the exact classification change.

The stable after profile has committed source tree
`535a61b455130aadc77d82089a8f999f30e29ad7`, committed test tree
`40580663ccc35e8d11c74c09ce8bc2b62b422748`, and 212 tracked source-file hashes with
manifest SHA-256
`6078ede6811deb7e607e3b3988eb6e52553d492dff4b5d6b8821acbff98ad083`.
All 3,533 current test-program input hashes have manifest SHA-256
`73554ad05e8368b340507d956d32280ae2e4afa0cd4724d1b93b0503db1d5e42`.
The capture deliberately never opens/hashes the protected reviewer prefix;
its then-current program contribution is zero, and no full future live-test
closure is inferred. The opaque committed tests-tree identity is recorded.

The config hash changes are limited to:

| Path | Before SHA-256 | After SHA-256 |
| --- | --- | --- |
| `tsconfig.json` | `31a3ef68430276b806701fe5d24d86aa7bb3d1630d79b4d5f381d6cd2c2a4c08` | `f473dbe2230f833bbd374f6d211e843da377973fa96ad0eb38b6b5740dd18027` |
| `package.json` | `c9b768b3ec77ac19262a36ce46f331618916fd7746492d83f0bf6e1212999360` | `2d98aad926c0a877ed4c3e5ac088cb498526e4769d30f9ab092cfd2bbeb7f9c7` |

`package-lock.json` remains
`9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b`;
`tsconfig.build.json` remains
`b57d3e5aab1f1f7ab7a70f275183ea6de255e65a2c40a0047c08d97769a1a16e`.

## Current inclusion census

The stable post-fix **actual compiler program is 3,882 files**: 176 production
source inputs, 3,533 test-tree inputs, and 173 other library/type inputs. The
pre-fix second capture has 3,886 (176+3,537+173). The net reduction is four:
six raw inputs removed and this author's real test/helper pair added.

The actual current glob finds **540/540 compiler-included test paths**, and the
exact prune still selects all540. These are **533/533 already tracked canonical
tests**, this author's new control test, and six pre-existing ignored copied
tests below `regex-execution/cleanup-registration/artifacts/phase-a`. Thus 540
is a live discovery denominator, **not** a maintained-source-only test count.
After committing this new test, the same census contains534 tracked test paths
if no concurrent changes occur. Full actual path lists, separate tracked lists,
and all per-path hashes are retained in `after.json`.

Explicit positive inclusion controls cover `src/index.ts`, `src/shell/shell.ts`,
`src/commands/search/glob.ts`, main command/search/shell helpers, both original
continuation glob tests, and `tests/contracts/command.test.ts`. These are all
still in the real global program. Other evidence/artifact trees are not excluded.

## Scoped positive and negative controls

Run from the repository root:

```sh
node --import tsx --test tests/plugins/qualified-current-release-native-data/controls.test.ts
node node_modules/typescript/bin/tsc -p tsconfig.build.json --noEmit --pretty false
```

`controls-final.json` records **5/5 passing author controls**, zero skips/TODOs,
exit0, and the production build-config noEmit check exit0. The original
`controls-initial.json` is retained: 4/5 passed, while the nested test-runner
capture inherited `NODE_TEST_CONTEXT` and had no TAP summary. The helper now
removes only that variable from its copied-child environment. This is an author
harness correction, not an undocumented product fix or unchanged-input claim.

Actual isolated commands/outcomes asserted by the five tests:

- Root-config structural comparison: unchanged options/includes and exactly one
  added exclusion. Manifest: all72 entries classified; all six exact raw hashes.
- `node <installed-tsc> --noEmit --pretty false` in a copy of the real root
  config/package: **exit0** with six valid production/test/helper/neighbor files
  and two invalid native payload files. Actual `--listFilesOnly` includes all six
  eligible paths and no native path.
- Same command in another copy with identical `hit\n` bytes at the six outside
  paths and one inside path: **exit2**, exactly six real TS2304 diagnostics at the
  outside production source, canonical test, helper, native-neighbor artifact,
  sibling artifact helper, and unrelated `artifacts/native` helper. No `any`,
  `ts-ignore`, genuine-code exclusion or original-file mutation is used.
- Actual copied current `npm test`: **exit0, 5/5**, canonical test imports its
  helper; four neighboring tests execute, including whitespace/Unicode paths.
  Both direct and nested native `.test.ts` canaries remain unselected/unexecuted.
- Actual copied old `npm test`: **exit1, 5 pass/2 fail out of7**, both exact
  canaries throw `NATIVE_DATA_MUST_NOT_EXECUTE`. The same old glob selects all7;
  this proves a runner-level data-discovery difference, not just a stub filter.

`verify.mjs controls-committed` can create a fresh, uniquely named scoped record;
`capture.mjs after-02` can capture a new live global gate and fixture hashes.
Capture outputs use exclusive creation, never overwrite historical evidence.
Capture asserts fixture/config preservation and absence/presence of the six
scoped diagnostics, but **its own exit0 does not mean the recorded global gate
is green**: inspect `gate.status`, diagnostics and stability flags.

## Remaining limits and root handoff

No full root `npm test`, emitted product build, package install, watcher, source
evaluation, native cleanup or independent holdout was run. The standalone `.mts`
inventory is intentionally not revised. Dirac `aac345a0` canonical470/470 and
485/485, original11/30 omissions, current build-first22inputs/13groups, prior
source-public65 `b7ae`/`66b079a`, and the `966cfac`/`5456730` release-helper changes
remain separate historical/current records. Frozen current-qualified02 still
fails WebDAV12/13; this config correction does not close that Poincare-owned
fixture work. Runtime1b133a8/Sagan closure is distinct from Arch's still-unclosed
five actual public-boundary replay cases.

Root should route the eight current foreign sealed-input diagnostics to their
owner and commission the different verifier only after actual author CLOSED.
No other configuration/source authority follows from this patch. The exact
atomic commit is supplied in `/tmp/safe-bash-native-data-config-final.txt` and
the final response; this report deliberately avoids a self-referential commit
hash. The separate status/needs-root/result reports preserve coordination facts.
