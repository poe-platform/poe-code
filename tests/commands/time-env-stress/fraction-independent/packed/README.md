# Independent fraction packed/cohort verification

**Frozen READY, scoped evidence only.** Independent thread
`01a0426e-f309-7682-bfbf-2cd25393acf3`, not Curie or the prior fix reviewer.
No delegation, production edits, original-fixture changes, canonical migrations,
root integration, dependency installation, or sibling semantics-case inspection.

## Results

Candidate is the entire committed `c7823633ee99f711f1319ace59d4cf2b7f622ecc`
archive, including ancestor `f6406cdc1d946bbe829535d888d6e8a09a7c8d9e`.
Author claims/evidence are pinned separately to `4a0cbe7`.

| Cohort | Execution and provenance | Actual result |
| --- | --- | --- |
| Original223 | Unchanged `d904ca9` fixtures, full candidate source archive | **221 pass, 2 fail**, no skips |
| Existing83 | Unchanged `db369ef` regression fixtures, full candidate source archive | **83/83** |
| New54 | Unchanged committed fraction/ISO fixtures, full candidate source archive | **54/54** |
| Original305 | `75d4e0c` whole consumer, packed emitted JS; import paths only adapted | **304 pass, 1 Apple-profile fail** |
| Immutable304 | Byte-identical `2542cfa` holdout and guard, packed emitted JS | **304/304** |
| Original sleep8 | Lifecycle/isolation rows within original305, not additional tests | **8/8** |
| Existing36 matrix | `db369ef` whole native-neighbor corpus, packed imports only adapted | **31 GNU matches, 5 nonmatches; 0 Apple matches** |
| Independent controls14 | Public root + explicitly distinguished internal packed leaf | **14/14** |

Each cohort runs once on the appropriate frozen profile. No case exclusion,
oracle selection, assertion change, label replacement, retry, or TODO conversion.
The original eleven `declared-N-format-gap-not-parity` labels remain unchanged
even though their assertions now pass. The three source suites cannot be called
packed/public runs: their original fixtures import source internals, and one
spawns an unchanged source-import child. Rather than invent a public export or
rewrite those fixtures, the entire source archive is tested separately.

The two original223 failures are exactly:

- `date rejects unsupported/invalid input without stdout: -d@0 +%12N`
- `date rejects unsupported/invalid input without stdout: -d@0 +%-N`

Both expect status1 and receive status0. They remain failures of the original
assertions, not omitted tests or silently migrated expectations. Only Root may
coordinate the conditional two-assertion migration after separate SOURCE acceptance.

The original305 failure remains `Apple BSD printenv separate profile`, category
`Apple-BSD-observed-not-target`: status0/stderr empty on both sides; Apple stdout
hex `0a`, virtual stdout hex `0ae99baa0a`. The five existing36 ICU `%Z` differences
remain nonmatches for New York/year0008, Paris/year0008, Paris/2024-02-29,
New York/@-1 and Paris/@-1. GNU9.7 **built on Darwin** is not GNU/Linux evidence;
Apple results are separately retained, not required GNU-format parity.

The author's original before/after57 native captures are copied byte-for-byte,
not rerun or recast as independent native proof. In the historical after capture,
the12 bare `%-N` profile rows retain **11 raw GNU nonmatches and 1 exact match**;
the3 unsupported negative-calendar-year inputs also remain in that raw corpus.
No raw loss is relabeled a pass. Fresh semantic/native review belongs elsewhere.

## Real package and API boundary

- Full `git archive` has14,482 tracked paths and913,039,360 tar bytes. Every tracked
  path/content digest is unchanged after replay; all212 source files, original
  package/export configuration and compiler configurations are hashed individually.
- Node22.22.2, TypeScript5.9.3, Darwin arm64, ICU78.2, tzdb2025c. Node binary,
  compiler, cached development tools, GNU binary/official source archive,
  source files, exports, installed dist, emitted consumers and imports are hashed.
- Original `tsconfig.build.json` builds the archive. `npm pack --offline
  --ignore-scripts` uses owned HOME/cache. The tarball is extracted into a regular
  `consumer/node_modules/virtual-bash` tree with its own distinct consumer identity.
  No fake package, private shim, current dist, dependency symlink, source overlay,
  root-manifest edit or global TypeScript build is used.
- Package SHA256:
  `b42892cdcd2f765e4d99e857b68d43fe14dbcdff1c704e8b2dc4b9db6d2e756a`.
  Full archive SHA256:
  `4ba2f44723111446087b45a56269492492b34fa88df21b007a50aabf38e21530`.
- This pack includes the original21,632-byte root `README.md`. It is the only
  additional packed path versus the author's prior selected-tree pack, explaining
  the different tarball hash. Every dist byte matches the original-config build.
  The earlier original305/223/83 author's d904ca9-plus-time-env overlay replay is
  historical evidence, **not** this full frozen package/source replay.
- Positive consumer types and emission pass. Plain Node22 runs emitted JS with
  the byte-identical packed import guard, not tsx. The guard rejects an actual
  archived build-tree import; recorded successful product imports resolve only
  into the extracted package. Original305 changes only two import specifiers and
  their two resolution-metadata strings. Existing36 changes only two imports.

**Time-env is still not a public root or export-map subpath API.** The legitimate
packed physical leaf is not falsely called an exported public entry point.
Exported root Shell/FS/registry/plugin APIs work, and the exact default registry
still has65 commands, excluding date/sleep/printenv. No three-tool default or
public-leaf integration acceptance is claimed.

Public-root negative types fail for TS2353 (unknown Shell option) and TS2322
(wrong command callback). Five separate **internal packed leaf** controls fail for
unknown options, wrong clock results, incomplete schedulers, nonnumeric output
limits and incorrect timer callback parameters: TS2353, TS2322, TS2741, TS2322,
TS2322. Positive types pass first. These are not missing-module/config failures.
The separate root time-env import probe produces TS2724/TS2305 and runtime subpath
import produces ERR_PACKAGE_PATH_NOT_EXPORTED: those establish an API gap, not
successful public time-env option checking.

Controls cover unchanged family limit definitions, UTF8/newline/repeated-field
output admission, width admission, no partial writes, public shared-budget
accounting without byte-content deduplication, invalid injected capabilities,
clock sample counts/precision, preabort, sleep cancellation cleanup and host
environment isolation. New controls only retain/lower limits; the unchanged
author54 retains its original explicit large-width test settings. No source
mutants or product native execution are introduced here.

## Evidence, cleanup and reproduction

`evidence-final/manifest.json` records commands, process groups, raw byte counts,
hashes, fixtures, adaptations and source/package immutability. `results.json`
indexes every source test name/status and cohort results. `holdouts.json`,
`hidden-rows.json`, `controls.json` and `fresh-native-matrix.json` retain original
per-row captures including status/stdoutHex/stderrHex where fixtures record them.
Raw `.stdout`/`.stderr` files preserve exact runner bytes. Some assertion-only
original controls do not log individual command bytes; none are invented.

`evidence/` is the initial harness attempt: positive type checking caught an owned
`assert.rejects` call accepting a possibly synchronous CommandResult. An async
wrapper fixes only that new control; **no cohort ran in the initial attempt**.
Both attempts' package hashes match, all initial output is retained, and the
corrected final run is2026-08-27T09:04:57.880Z–09:05:31.917Z. This is measured
capture time, not a72-hour work claim or performance benchmark.

All supervised children close cleanly with no survivors, timeout, signals or
output overrun. Both unique source/tarball/tool/consumer/native scratch trees are
removed and ENOENT-checked. The unchanged original223 isolated child replaces its
environment, dropping the parent's TSX_DISABLE_CACHE/TMPDIR; its19 global tsx
cache entries were identified by exact unique scratch source-map paths, hashes,
inode and run-window timestamps, then individually removed. Cleanup evidence
records this exception. No foreign cache file/directory or fixture is removed.

Run only with existing cached development tools and the pinned local GNU9.7
oracle. Output must be a new directory; archives/test scratch remain outside
repository test trees. From the repository root:

```sh
node tests/commands/time-env-stress/fraction-independent/packed/verify.mjs /tmp/fraction-packed-unique-evidence
node tests/commands/time-env-stress/fraction-independent/packed/cleanup-cache.mjs /tmp/fraction-packed-unique-evidence
node tests/commands/time-env-stress/fraction-independent/packed/summarize.mjs /tmp/fraction-packed-unique-evidence
node tests/commands/time-env-stress/fraction-independent/packed/seal.mjs --check
```

The capture driver records failures without halting later cohorts; `summarize`
checks the exact scoped result pattern, including the retained failures. Seal
verification checks this committed proof, not a newly generated output directory.
No new source bug is found within this scope. Public time-env export acceptance,
SOURCE semantics acceptance, canonical migration, full-gate, deployed-provider,
performance and superiority claims remain outside this verification.
