# Independent cold-typecheck configuration review

## Verdict for root commit review

**The three-file configuration delta is verified. An unqualified “all actual
TypeScript source/test files are included except one consumer” claim is not.**
All frozen canonical `.test.ts` files and all `src/**/*.ts` / `tests/**/*.ts`
root inputs are included except the intentionally routed historical consumer.
However, the unchanged root include glob already omits **11 standalone `.mts`
files at e36dab2 and 30 at 0c8cf15**. These are pre-existing coverage limits,
not exclusions introduced by this patch. Some are retained evidence programs;
one is `tests/fs/webdav/consumer/consumer.test.mts`. Their paths are inventoried,
not executed, and are not silently counted as passes or added to this task.

No product/configuration fix is requested or made here. Root must retain the
`.mts` qualification when accepting the bounded configuration review. The
frozen author-current root typecheck is still red for the unrelated Faraday-owned
TS7053. This review does not certify moving HEAD, a full gate, provider behavior,
native-tool parity or superiority over just-bash. No commit or staging is made.

## Frozen provenance

- Paired source: `e36dab2b6abc216ddc89e5786a0eba76f08a1722`.
- Configuration/source: `0c8cf157971e8e8e6aa8bb0e70f97240c41bc609`.
- Actual patch parent: `37cc89594a708951d454e3a13c443d701ea9df68`.
- Retained evidence: `5ce00c1e6d1a3b722c602479d994aaa1a6e95061`.
- Closed authentication checkpoint `010411eff3dd210b9575e061914efccd65c13547`
  remains context only, not a reopened authentication task.

`check.mjs` is independent of the author's runner, inspector and supervisor.
It recreates the complete commits using Git archives and a Node-built-in tar
reader, checks every regular file against its Git blob and SHA256, and matches
the retained archive and source-manifest digests. Snapshot totals are 7,932 files
/ 562,123,340 bytes and 9,204 files / 634,173,882 bytes respectively. All 109 retained
capture entries match their encoded/raw byte lengths and hashes. Old evidence,
including preliminary failures, remains untouched in its original location.

The e36 control overlays only the fixed root config, dedicated consumer config
and added package script. The package objects otherwise match exactly. The
author commit changes exactly those three paths; no source, assertion, lock,
export, dependency or existing script changes occur. Compiler options are
unchanged. In particular, root `skipLibCheck:true` is pre-existing, not newly
introduced; the dedicated and packed consumers use `skipLibCheck:false`.

Both original and fixed actual compiler file lists are compared: the **entire
list difference is exactly `selected-gnu.ts`**. Four imported `.d.mts`
declarations and six authenticated `benchmarks/*.ts` helpers also appear in
each list. They are recorded separately from root glob inputs. No directory-wide
allowance, compiler suppression, new broad exclusion or assertion replacement
is used to obtain the measured results.

## Actual results

| Measurement | e36 + config-only overlay | Frozen 0c8cf15 |
| --- | ---: | ---: |
| Original cold diagnostics, no dist | 6; exit 2 | 7; exit 2 |
| Fixed cold diagnostics, no dist | 0; exit 0 | 1; exit 2 |
| Canonical tests included | 470/470 | 485/485 |
| Source `.ts` roots included | 143/143 | 155/155 |
| Test `.ts` roots included | 748/749 | 911/912 |
| Root `.ts` inputs after routing | 891 | 1,066 |
| Transitive `.d.mts` inputs | 4 | 4 |
| Pre-existing standalone `.mts` omissions | 11 | 30 |
| Dedicated consumer before build | original 6 errors | original 6 errors |
| `npm run typecheck:consumers` | exit 0 | exit 0 |
| Unchanged standalone consumer, strict/library check | exit 0 | exit 0 |
| Real packed imports / registered commands / pipelines | 20 / 60 / 4 | 20 / 60 / 4 |

The single routed test-tree program is
`tests/commands/table-text-stress/shared-stdin-review/selected-gnu.ts`;
it is not a canonical `.test.ts`. Its SHA256 is unchanged across both sources,
the patch parent and restoration after the negative control:

```text
fac0fb98961398bf8c4fb420d3d9549588ccde730457fe075c968d91bcdec0e8
```

Its six original diagnostics are TS2307 at `(34,119)` and `(35,65)`, then TS7006
at `(37,50)`, `(38,43)`, `(41,29)` and `(61,58)`. The seventh author diagnostic,
preserved byte-for-byte in raw output and unchanged by the fix, is TS7053 at
`tests/commands/stream-next-stress/independent.test.ts(91,95)`.
The original historical runtime READY gate and obsolete 56-command assertion
are not executed; the entire unchanged file is strictly typechecked after build.

## Negative and declaration controls

- A new real `.test.ts` probe adds exactly TS2322 to cold root typing, retaining
  the author TS7053. Removing the probe restores original source bytes.
- Appending a type mismatch to the historical consumer adds exactly TS2322 in
  its dedicated strict configuration; the original bytes are restored and hashed.
- The original packed invalid fixture emits exactly TS2345 at `invalid.mts(4,23)`,
  TS2741 at `(5,7)` and TS2322 at `(7,40)`. No ignore comments or widened types.
- Packed positive fixtures retain their original 0c8cf15 bytes and are checked
  strictly with library checking enabled. Every product compiler input resolves
  into packed `dist/*.d.ts`, not workspace source or a path alias.
- A deliberate constraint violation in packed `dist/index.d.ts` emits exactly
  TS2344 at `(27,61)`, proving declaration contents are actually checked.
- Temporarily removing all 57 reached packed declarations emits exactly six
  TS7016 errors despite intact workspace source **and workspace dist**. Restoring
  those declarations restores a clean strict check. This is stronger than only
  rejecting a runtime source import.
- The independent runtime guard also rejects an attempted workspace source import.
  All 20 public imports, 60 actual registry entries and four exact-byte virtual
  pipelines execute against the extracted package, with no network/provider work.

The tarballs are produced by offline `npm pack --ignore-scripts` and extracted
as regular files with Node builtins into a separate consumer. **No npm install**
is used. This verifies real packed content/imports, not npm installation behavior.

## Dependencies, failures and budget

Environment: macOS arm64, Node v22.22.2, npm 10.9.7. Exactly 247 existing files
from TypeScript 5.9.3, `@types/node` 22.20.1 and its `undici-types` 6.21.0 closure
are copied and hashed before/after. Versions and installed lock metadata match
the frozen lock. Registry tarball integrity is not independently downloaded or
recomputed; this is verified reuse of existing installed bytes, not fresh
dependency authentication. No tsx/esbuild or third-party downloaded scripts run.

Two independent checker errors remain preserved, not rewritten to green:
`evidence/` incorrectly omitted imported `.d.mts` declarations from its expected
inventory; `evidence-final/` incorrectly rejected six imported benchmark helpers.
Both checker versions, full failures, original diagnostics and raw outputs remain.
See `inventory-correction.md`. Correcting exact inventory/containment did not relax
diagnostic, config, runtime, consumer or declaration assertions.

`evidence-complete/` reuses six successful second-attempt phases without rerunning
them: the exact removed temporary root is reconstructed from the same Git blobs,
source/archive/dependency hashes are checked, cwd/argv/status match, and raw
stdout/stderr are copied byte-for-byte. Each reused phase is labeled explicitly.
The remaining 31 phases execute afresh. Cumulative execution is **42 supervised
tool phases plus two syntax checks = 44**, with no concurrent compilers. The three
runner elapsed times are 13.148, 16.192 and 47.231 seconds; these are not claims
about total work duration. No timeout or surviving child group is observed.

The live checkout moved independently during review. The final control attempt
captured HEAD changing from `ab7cce5b8ae3ba88012f4ec682cf9a65b32fb2f7` to
`839f2d468311d170ba80d5bf19db94484f9afd66`, with 504 tracked canonical tests.
Initial inspection had seen dirty/staged concurrent work at `4e2d71c`. All
context/status/index hashes are retained. **504 is not the frozen 485 cohort**;
no current checkout typecheck, rebuild or full gate is run. No native-archive
prerequisite check, private poe-code access, WebDAV or authentication workflow
is performed. Final owned temporary snapshots are removed.

## Reproduction and handoff

From the repository root, with the same existing locked dependency closure:

```sh
node tests/integration/full-gate-20260827/cold-typecheck-independent/check.mjs \
  tests/integration/full-gate-20260827/cold-typecheck-independent/evidence-replay-NEW
```

Use a new output directory. A fresh replay executes all 37 bounded phases; it
does not reuse historical outputs. The recorded continuation command is:

```sh
node tests/integration/full-gate-20260827/cold-typecheck-independent/check.mjs \
  tests/integration/full-gate-20260827/cold-typecheck-independent/evidence-complete \
  tests/integration/full-gate-20260827/cold-typecheck-independent/evidence-final
```

That exact output already exists and must not be overwritten. Every actual
command/cwd/exit/timeout and raw stdout/stderr is in the reports and generated
`commands.txt`; `diagnostics.json` is a convenience summary, not a substitute for
raw logs. Exact omitted-file lists are in `inclusion.json` and each snapshot's
results. `final-manifest.json` lists explicit owned hashes; `state-audit.json`
records final process/temp/index/owned status. The requested external handoffs
are `/tmp/safe-bash-cold-typecheck-independent-plan.txt` and
`/tmp/safe-bash-cold-typecheck-independent-detail.txt`. Stop here for root commit
review; do not treat this report as a new full-gate acceptance.
