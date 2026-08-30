# Independent tree initial checkpoint

Candidate: `e2d1b9230f4304650651572395523ca9d1644e74`. Standalone direct source
module only, not root exports, default registration or public package acceptance.
The author remains stopped until root routes a subsequent handoff.

Original seal: `b9863722f41cbdd56119ab95c3446ca3b65a5b752ccafc28dc6f9044854d2937`.
All 97 original artifacts and the corpus/oracle/predicates remain byte-identical
under `sealed/`. Historical PREP records still say zero product executions;
that describes PREP, not this later run. Read `PRESEAL-ERRATA.md` for the preserved
attribution correction and corroborated native build provenance.

## Initial results

| Lane | Result |
| --- | --- |
| 38 sealed selections, once each | 30 pass, 2 fail, 3 unsupported, 3 characterized |
| Actual tree invocations | 35, within 7.821 seconds total |
| Raw native bytes/status across 20 captures | 12 match, 5 differ, 3 unsupported/not run |
| Exact-native predicate selections | 12 pass, 1 fail, 3 unsupported |
| Other native-derived semantic predicates | 3 pass, 1 fail |
| Adversarial/positive cases | 15 pass, 3 characterized/not pass |
| Source bugs demonstrated / outside-core failures | 0 / 0 |
| Startup errors / timeouts / watchdog cancellation / incomplete | 0 / 0 / 0 / 0 |

N16 fails the sealed native expectation because the declared candidate does not
follow explicit root links without `-l`. N18 fails the original diagnostic regex:
`tree: -L must be between 1 and 256` rejects zero correctly but lacks the regex's
selected words. Both raw failures remain; neither was fixed or rerun to green.
N14 sibling aliases, N17 file/missing roots and N20 JSON whitespace also differ
in the raw native lane even where semantic predicates pass. No universal parity
or superiority claim follows. Root routing is retained in
`evidence/initial/root-failure-route.txt`.

## Frozen evidence

The snapshot contains all 13,887 regular files of the exact commit plus 318
copied development-dependency files. Installed package versions match the lock.
All 14,205 full inputs hash identically after the run; 31 source and 22 tool
modules observed in V8 coverage load only from the snapshot. No moving live
source import, source patch, staging or commit occurred.

`evidence/initial/` retains full input/source/dependency manifests, raw per-case
bytes and process results, predeclared profile, observed real Shell pipeline,
native provenance checks and compact coverage index. Large original coverage
files and the full candidate snapshot remain at their recorded `/tmp` paths;
they are not duplicated into this repository. The 20 original native captures
were reused without recapture or native rebuild/download.

## Run verification or a new frozen cohort

Always-runnable evidence and fixture checks, without the candidate or native tool:

```sh
node --test tests/commands/filesystem-inspection-stress/tree/verify-evidence.test.mjs tests/commands/filesystem-inspection-stress/tree/sealed/selftest.mjs
```

After explicit root authorization, rerun against the same complete immutable
snapshot (every source and copied dependency hash is checked before import):

```sh
TREE_HOLDOUT_ROOT_RESUMED=AUTHOR_FINISHED node tests/commands/filesystem-inspection-stress/tree/run-frozen.mjs /tmp/safe-bash-tree-initial-run-NN3E3X/candidate
```

This creates a new `/tmp` cohort, never overwrites initial evidence, and retains
the two-minute per-process and ten-minute cohort ceilings. The sealed runner's
own two-second settlement guard is also unchanged. The frozen existing profile
is reused; unsupported stays unsupported. The replay exits nonzero for retained
raw failures, including N16/N18. `driver/` preserves the original
capture/binding scripts; `run-frozen.mjs` is the relocatable replay entry point.

## Limits

Scoped candidate types pass. No new built/public consumer, default integration,
full suite, remote deployment, or performance gate was run. A33 observes bounded
C-escaped Unicode names, not genuinely multibyte output bytes. A26's entry cap
fires before duplicate-name validation; A25 stops at the first invalid entry.
Those characterizations are not new contract requirements. Direct cancellation
checks are not public Shell cancellation proof. The actual Shell case covers
JSON, a real pipe, subshell, redirection and a registered stdin consumer, not jq.
See `STATIC-REVIEW.md` and `evidence/initial/analysis.json` for further boundaries.
