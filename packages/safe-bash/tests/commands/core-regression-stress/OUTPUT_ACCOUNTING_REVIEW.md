# Independent output-accounting acceptance — August 27, 2026

Source reviewed: **f7000b05b15fa34371226b35cf537d3f73bbf004**, complete committed
source, not its runtime overlaid onto954f230. Runtime SHA256:
`c7c9d02ddde5576b7810bfecbbd21b70c6eb2c0ea4fe1ee8bee92c21946d8449`.
Only new review tests/drivers/evidence and this owned documentation changed.
Runtime remains Sagan-owned; no production source fix was needed or made.

## Unchanged acceptance

| Cohort | Historical | Frozen f7000b0 |
| --- | --- | --- |
| Original independent accounting18 | 9/18 | **17/18** |
| Eight originally failed budget rows | 0/8 | **8/8** |
| Other original budget controls | 9/9 | **9/9** |
| Original raw Apple order row | 0/1 | **0/1**, retained |
| Original independent core100 | 89/100 before280815c;100/100 after | **100/100** |
| Original six benchmark recipes | 4/6 historical;6/6 at954f230 | **6/6** |
| Actual runtime acceptance | 2/10 historical;10/10 at954f230 | **10/10** |
| Focused boundary/order/shell cohort | 111/111 at954f230 | **111/111** |
| New independent accounting guards | Not previously measured | **8/8** |
| Author accounting tests, independently rerun | Author29/29 | **29/29** |

All Node cohorts have zero skips/TODO/cancellations. Author29 includes its
bounded subprocess; internal assertions are not counted again. The unchanged
18-row audit intentionally still exits1 for the Apple order mismatch. The outer
review does not label it18/18, unsupported, or a budget failure.

The eight repaired rows are explicit and nested-explicit forwarding for each
of replaceEnv omitted/false/true (six), the original `env -i tick` output-budget
dispatch witness, and minimal same-sink forwarding. The latter now emits four
bytes successfully under limit4. Repeated identical payloads and separate real
pipeline writes still consume budget independently. No variable leakage was
observed in the retained actual-runtime acceptance; this is not full env parity.

`env -i A=1 B=2` still produces `B=2\nA=1\n`, matching the pinned GNU9.7/Darwin
capture but not Apple's `A=1\nB=2\n`. POSIX assigns no meaning to environment
order. `NORMATIVE_PROFILES.md` separates map equivalence from byte-profile match;
neither the original env fixture nor the six benchmark expectations changed.

## Undercharge and lifecycle guards

The eight new actual-Shell controls cover fresh external sinks, a genuinely
foreign known Budget sink passed through literal invoke, a known sink whose
writer changes, writer mutation after transparent wrapping, cross-channel
shared accounting, downstream failure without refund, concurrent reservation
before asynchronous effects, and pending forwarded output cancellation with
the identical caller reason and observed late rejection.

Seven isolated runtime mutants are all detected, with every mutant completing
all8 guards and all18 unchanged accounting rows normally:

| Mutant | Guard failures | Original budget-row failures |
| --- | ---: | ---: |
| Omit owning-Budget check | 1 | 0 |
| Omit writer-identity check | 1 | 0 |
| Dynamically resolve a previously verified writer | 1 | 0 |
| Charge only after successful downstream write | 2 | 0 |
| Exempt unknown sinks | 7 | 13 |
| Inflate byte quota | 7 | 13 |
| Deduplicate payload content | 1 | 13 |

No compiler/load error is counted as a detected semantic mutant. Source and
test manifests are equal before/after; temporary mutations are restored. These
are separate from the earlier seven wc/sort/env/cksum/realpath mutants.

**Initial probe correction retained:** the first independent guard design passed
a foreign sink only as a Shell.exec observer. That route creates an unknown
capture/observer wrapper, so removing the known-Budget identity check survived:
6/7 mutants detected, not7/7. I changed only the new foreign-sink probe route to
pass the known foreign sink through CommandContext.invoke. Expected four-byte
delivery and inner limit failure are unchanged. The strengthened probe detects
the mutant; no old test/native expected value or production source changed.
Both raw runs are preserved as separate evidence files.

## Types, source equality and evidence

All-source plus selected-test noEmit and isolated production build both exit0
on the same source snapshot. This independently covers the old TS2412 location
after0f5dbb3; the earlier280815c failure remains historical. This is not a new
global-test or benchmark-typecheck claim. The six-recipe runner uses its
original0294afb harness, immutable golden file, and the identical f7000b0 source
hashes. Dev dependencies are reused; no runtime dependency or network in product.

- `evidence/output-accounting-f7000b0.json`: final observations, raw TAP,
  source/test manifests, selected compiler outputs and seven mutations.
- `evidence/output-accounting-initial-probe.json`: initial6/7 mutation result.
- `evidence/output-accounting-six.json`: unchanged six recipes, source hashes.
- `evidence/output-accounting-integrity.json`: source equality, dependency hashes,
  and byte-for-byte preservation checks for old test/fixture inputs.
- `evidence/normative-profile-sources.json`: independently fetched primary sources,
  actual GNU/Darwin linkage, SGID archive hash checks, Linux-not-tested boundary.

Reproduce from repository root:

```sh
node tests/commands/core-regression-stress/verify-output-accounting.mjs
node benchmarks/reports/core-fixes-20260827/replay-six.mjs f7000b05b15fa34371226b35cf537d3f73bbf004 /tmp/NEW-unique-six-report.json
```

Do not overwrite prior reports. The driver archives fixed source and copies the
unchanged owned test inputs; only its isolated snapshot receives mutants. All
test children exit normally and there is no watcher. No general shell/kernel
parity, SGID profile closure, full-product acceptance or superiority follows.
The prior sort observation stays40.672→10.811 ms versus faster just-bash6.320 ms;
performance was not rerun in this accounting checkpoint.
