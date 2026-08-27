# Expanded comparison protocol

This is a new, bounded cohort, not a replacement for the historical 118 recipes
or the old command-coverage report. No product source is changed by this harness.
Different-agent fairness review remains required.

## Reproduce

From the repository root, with existing root development dependencies and the
isolated `benchmarks/node_modules/just-bash` 3.4.2 installation:

```sh
node --test benchmarks/expanded/harness.test.mjs
node --import tsx benchmarks/expanded/run.mjs benchmarks/reports/expanded-20260827/run-new HEAD
```

Output directories must not exist. The runner requires the harness to match the
selected committed harness revision, extracts the selected production source with
`git archive`, links cached development tooling, and never copies dirty product
files. It records all source hashes, baseline bundle/manifest/isolated-lock
hashes, runtime details and moving worktree status. It does not run the global
product suite or certify the moving worktree.

The first native capture is immutable. The historical corrected capture is
`native-corrected/native.json`; see
`benchmarks/reports/expanded-20260827/ORACLE_CORRECTIONS.md` for the two harness
defects and unchanged recipes. The historical first capture is:
`benchmarks/reports/expanded-20260827/native-first/native.json`. All 224 functional
recipes and four performance recipes had their declared native exit status
before initial product scoring. Declared exit validity alone was insufficient;
the corrected capture adds independent launcher/path controls. Native errors intentionally expected by a recipe are
valid observations, not exclusions. The current default is a separately retained
`native-scratch-aligned/native.json`: all engines receive a preexisting scratch
directory outside the asserted fixture. All228 native stdout/stderr/status
observations and recipes are unchanged; only patch dry-run's empty directory
effect changes. See `benchmarks/reports/expanded-20260827/SCRATCH_PROFILE_DELTA.md`.
The old scores are not retroactively changed. To capture another explicitly separate native
cohort with the installed, hashed oracles:

```sh
node benchmarks/expanded/capture.mjs benchmarks/reports/expanded-20260827/native-new
```

Native tools are resolved explicitly by `native.mjs`; missing tools fail capture
rather than silently changing profiles. `EXPANDED_BASH`, `EXPANDED_COREUTILS`,
`EXPANDED_GZIP`, `EXPANDED_SED`, `EXPANDED_TAR`, `EXPANDED_DIFF`, `EXPANDED_PATCH`
and `EXPANDED_RG` can select preinstalled tools. No automatic download or install
occurs. Native subprocesses run trusted static fixtures only; product commands
do not spawn processes. Fixtures use private temporary directories and loopback
HTTP, never external uploads or user files.

The runner accepts output, product revision, harness revision (default HEAD),
then native JSON path (default scratch-aligned capture). To hold product source fixed
while independently correcting the oracle harness:

```sh
node --test benchmarks/expanded/native-controls.test.mjs
node --import tsx benchmarks/expanded/run.mjs benchmarks/reports/expanded-20260827/corrected-new bd2cacb HEAD
```

## Denominators and assertions

- 168 command recipes: three option families for each of the authoritative 56
  default registrations, including metadata, archive and table-text.
- 36 kernel/script recipes, including bash/sh, executable and non-shebang scripts,
  source/dot/eval, substitution, control flow and descriptor redirection.
- 12 composition recipes and eight explicitly authorized local curl recipes.
- Four performance candidates, separate from the functional denominator.

Every functional row remains present, including unsupported commands, mismatches,
timeouts, capture errors and both-engine failures. Pass means exact output bytes,
stderr bytes, status and fixture-tree entries. Directories, symlink targets and
file bytes are included; selected permission recipes additionally compare mode
bits. Only temporary fixture roots, native role-bin paths and loopback origins
and the native scratch role are projected, using byte-safe replacement. There is no error-message whitening,
sort-to-green, content trimming or alternate product expectation.

The primary oracle is GNU Bash 5.3/coreutils 9.7, C locale, UTC; sed 4.9, gzip
1.14, GNU tar 1.35, diff 3.12 and patch 2.8 are also pinned. Other utilities are
individually hashed native executables, including Apple awk/find/grep/xargs/curl
and the installed jq/rg/xxd. This is **not** a uniformly GNU utility profile.
Exact identity and version-output evidence is in native.json. Release metadata
is in release.json; installed-release declarations take precedence over mutable
main-branch documentation for API invocation.

## Byte transport and instrumentation

The product API uses Uint8Array stdin/stdout/stderr. The baseline receives its
documented latin1 byte-shaped stdin with `stdinKind: "bytes"`; output uses its
public `stdoutAsBytes`/`latin1FromBytes` conversion, without guessing encoding.
Uninstrumented controls separately check invalid UTF-8, valid UTF-8 and NUL through
terminal output, an internal base64 pipeline and VFS redirection. A terminal API
metadata loss is not evidence of internal pipeline corruption. Raw differences
remain visible in the main cohort and the controls; no encoding repair hides them.

Registry tracing distinguishes actual plugin invocation from shell-shadowed
names. Baseline tracing uses its pinned private registry, checked against the
public name list; plain fresh-process controls test instrumentation neutrality.
The classifier's recognized names are not automatically counted as implemented
builtins. Inventory union includes actual shell dispatch and bash/sh entrypoints.
Name coverage does not imply all options, aliases or semantics are supported.

## Performance and limits

Only candidates matching native outputs and filesystem effects in **both**
engines qualify. Five trials per engine alternate order, use fresh child processes
and one same-workload warmup, and validate outputs/effects again each time.
Import/setup/snapshot time is excluded from executeMs. Instrumentation is off.
Full raw measurements include two-millisecond sampled RSS/heap/external memory,
before/after memory and process-lifetime maxRSS (including startup and warmup).
Sampling misses synchronous peaks; subprocess isolation does not remove shared
host load. Five repetitions do not support statistical or general superiority.

This cohort does not establish remote backend parity, DNS/socket confinement,
full shell/tool support, ownership/timestamp parity, all limits, concurrency or
outside-fixture preservation. Optional SafeJS/Python/JavaScript are not compared.
Uncovered baseline commands remain explicit inventory gaps. The full product,
72-hour and “much better” requirements remain unproven.

The separate `benchmarks/reports/expanded-20260827/baseline-only-frozen/`
matrix retains all53 baseline-only names from the frozen inventory. Three
primary recipes (dot/source/eval) are ours0/3 versus baseline3/3; the other50
names are unmeasured, not passes. This extracts existing evidence, not a new
execution or proof about later source/dot/eval implementations. Reproduce into
a new directory with `node benchmarks/expanded/baseline-only.mjs PATH`.
