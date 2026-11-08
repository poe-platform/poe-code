# Canonical GNU5.3 / safeplugin profile migration — preparation only

**No existing assertion has been changed. Stop for root confirmation and the
separate independent native freeze before implementation.** This is a coherent
proposal, not approval of broader shell parity, modes, or a clean global gate.

## Inventory reconciliation

The user routing text is preserved verbatim in `inputs.json`:
“27 canonical historicalprofile failures +2truthfulclassification assertions”.
The actual category table in `tests/integration/full-gate-20260827/REPORT.md`
and its complete classification artifact contain **27 total**, comprising
**25 historical/native-profile differences +2 truthful registry labels**.
There are not 29 identified rows. No missing rows were invented.

| Exact existing file (read-only in this phase) | Current unchanged archive | Classified failures |
| --- | --- | --- |
| `tests/shell/invocation-discovery-fixes.test.ts` | 96/112 | 16 historical3.2 |
| `tests/shell-stress/differential.test.ts` | 73/78 | 5 strict-native |
| `tests/shell-stress/current-gaps/compatibility.test.ts` | 7/11 | 4 strict-native |
| `tests/shell-stress/invocation-closure/holdout.test.ts` | 32/34 | 2 labels |
| Total | **208/235, 27 failed** | zero skips/cancellations/TODO |

Each whole file ran once unchanged on committed source6e. These are new scoped
measurements, not additions to the original full-gate denominator. The original
full-gate row diagnostics, test text/blobs/hashes, fixture/helper/native contents
and source manifest are retained in `inputs.json`. Original helpers and native
artifacts remain untouched.

### Exact failing rows

Discovery: `historical-3.2/{bash,sh}/` crossed with all eight names:
`empty-path`, `terminator`, `unknown-z`, `unknown-x`, `unknown-combined`,
`unknown-first`, `unknown-long`, `unknown-line` — **16**, not eight.

Differential: `nested-substitution-syntax-error-does-not-prevent-earlier-effects`,
`fatal-parameter-expansion-prevents-following-file-effect`,
`fatal-arithmetic-expansion-prevents-following-file-effect`,
`fatal-expansion-in-substitution-stops-substitution-only`, and
`command-substitution-removes-nul-bytes` — **5**.

Current gaps: `move-output-really-closes-source`,
`move-input-really-closes-source`, `prevalidation-prior-output-and-file`, and
`fatal-parameter-preserves-only-earlier-effects` — **4**.

Closure: `query-V-verbose` and `type-multiple-status` — **2**. Native `printf`
is a builtin; this product's registered `printf` must not be mislabeled builtin.
Every row's original and proposed full tuple is in `proposal.json`.

## Uniform protocols and native evidence

Both binaries were checked against the user pins before capture and afterward:

- GNU5.3 primary: `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA256
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical `/bin/bash`3.2: SHA256
  `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.

Fresh capture is **352 observations**: all 72 differential +5 syntax +11
additional inputs, on both binaries, under both protocols below. No per-case
oracle selection or source rewriting occurred:

```
original: --noprofile --norc -c EXACT_ORIGINAL_SCRIPT shell-stress
proposed: --noprofile --norc -c EXACT_ORIGINAL_SCRIPT shell
```

Only the supplied invocation-name argument differs. Script bytes, newlines,
stdin, initial files, fixture environment and profile are unchanged. No stderr
normalization is performed. `$0=shell` matches the existing virtual execution
context. Captures use scrubbed C locale, explicit PATH, isolated directories,
1,500ms process-group deadlines and 65,536-byte ceilings. Raw status, stderr and
stdout hex, argv, environment, exact input, before/after modes/bytes and process
outcomes are retained in `native.json`; no native timeout/error occurred.
Host cat/head dependencies and parent umask are recorded. Product code never
executes native tools.

Complete existing native discovery profiles (**52 each**, 104 observations) and
closure profiles (**26 each**, 52 observations) are reused with pinned binary and
fixture/cohort hash validation. Their full original contents are frozen in
`inputs.json`. No fresh native read-N/closure capture is performed. The assigned
unchanged holdout file still runs its eight existing host groups within its
34-test denominator; no separate lifecycle/kernel suite is invoked.
The original full-gate nine-case, two-profile report is also copied verbatim as
structured data in `historical-fullgate-native.json`, with its original hash.

| Full 88-input raw comparison | Existing tuple fields exact | Including full modes |
| --- | ---: | ---: |
| GNU5.3, original `shell-stress` | 74/88 | 37/88 |
| GNU5.3, proposed `shell` | **88/88** | **48/88** |
| Bash3.2, original `shell-stress` | 74/88 | 37/88 |
| Bash3.2, proposed `shell` | 74/88 | 37/88 |

“Existing tuple” means status, exact stdout/stderr bytes, file kinds/names/content
as asserted by the original helpers. Forty GNU-aligned rows additionally differ
in stored modes: for example native file0100644 under umask022 versus VFS
file0100666. **No full-mode parity or waiver is proposed.** These supplementary
losses remain in `comparison.json` and need root's profile/scope acknowledgement;
the originals never asserted modes. No existing file assertion is removed.
The five syntax controls already required only a nonempty diagnostic, hence
their raw diagnostic differences are not five extra canonical failures.

## Proposed implementation, pending confirmation

1. Discovery selects the entire named GNU-5.3 profile for canonical comparisons,
   with explicit fixture/native integrity checks. All 52 logical discovery
   inputs and eight safety/host controls remain. Preserve the entire strict
   historical52 in a new, explicitly runnable historical-profile harness with
   its 16 losses, rather than marking losses passed/skipped or overwriting them.
   Proposed canonical file count: **60**, not112. Historical52 stays a separate
   denominator; confirm this profile split before editing.
2. Differential and current-gaps import a new owned frozen-primary observation
   helper instead of the ambient `/bin/bash` oracle. It requires the exact input
   source/stdin/files/env hash and returns the native GNU5.3 `shell` tuple for
   **all** inputs. Keep `runVirtualScript`, real public imports, every complete
   equality and existing syntax/effect assertion. No helper/fixture source edit.
   Identity comes from the pinned capture, not the current host Bash version.
3. Closure labels only the two affected tests `safeplugin`, comparing full
   explicit policy tuples; retain native primary/historical tuples as losses.
   Do not replace every occurrence of “builtin” in arbitrary output. The first
   expected stdout is exactly:

   ```json
   "printf is a registered command\nclosurefn is a function\nclosurefn () \n{ \n    :\n}\nclosuretool is /work/tools/closuretool\n"
   ```

   The second is exactly
   `command\nfunction\nfile\nmixed:1\nprintf is a registered command\nclosuretool is tools/closuretool\n`.
   Both retain status0 and empty stderr bytes. The original declared native-cwd
   to VFS `/work` mapping remains explicit; no new diagnostic/path normalization.
   Full exact hex in `proposal.json` avoids Markdown trailing-space ambiguity.
4. New owned profile helper/native tuples must require no network, native install,
   or silently selected host Bash in canonical tests. Recapture is a separate
   explicit pin-checked command; frozen expectations are not sampled product
   output. Native capture and public/safeplugin contracts remain distinct.

Proposed canonical total is **183** (60+78+11+34), plus separately preserved
historical discovery52. This is a profile accounting change, **not 235 newly
passing native-parity tests**. Root must confirm the denominator, invocation
protocol, safeplugin labeling and supplementary mode limits. No mass golden
update, status allowance, skip/xfail, or stderr/file-assertion removal is planned.

## Source proof and primary specification

The archive contains all **173 source files** plus package, lockfile and both
tsconfigs from `6e3e3165e3b88aa5518eac33afd0b2ecdfa5fd2a`, verified against Git
blobs. All 23 existing copied test/helper/native inputs match that commit exactly.
No live source overlay or narrowed public API exists. The single linked directory
is the existing `node_modules` devtool installation, whose hashes stayed fixed.

The all-input product actor imports the unchanged `runtime()` and full real
`src/index.ts` / standard command composition. Archive before/after hashes did
not change; **183 actual TS loads**, including the root index, matched recorded
inputs. Legacy child helpers sometimes scrub NODE_OPTIONS, so actual-load tracing
is not claimed for every legacy child. Their unchanged archive paths remain
recorded; the complete new all-input actor is traced. No current live-source or
global typecheck/build acceptance is inferred.

Primary GNU manual sections consulted on August27,2026:
`https://www.gnu.org/s/bash/manual/html_node/Invoking-Bash.html` documents the
argument following `-c` as `$0`; `https://www.gnu.org/s/bash/manual/html_node/Bash-Builtins.html`
documents verbose `command` lookup and native `type -t` categories. These support
explicit invocation/classification profiles, not byte-exact diagnostic guarantees;
the pinned actual binaries supply the exact bytes. Registry `command` is a
separately declared safeplugin classification, not a native Bash category claim.

The independent review owner's fixtures were not inspected. No source, contracts,
root export, FS, dependency or existing test edits occurred. No broad kernel,
first-read/custom5 lifecycle or full-gate rerun, no global typing, no parity claim.
All owned children completed. Stop after the preparation-only commit and root
handoff; existing assertion migration awaits root's explicit continuation.
