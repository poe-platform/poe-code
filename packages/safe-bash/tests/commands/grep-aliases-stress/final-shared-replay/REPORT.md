# Final immutable alias replay — HOLD

The exact authorized candidate is `0123c83d3aae72a15621acbb29a165b97b2c6ab6`.
The unchanged original cohorts execute **82 subcases: 80 pass, two fail**.
This is not a green unchanged-cohort receipt or public-integration GO.
No new alias-specific defect is observed. Both remaining failures now expose
the exact return rejection rather than swallowing it. Their old assertions
require a fulfilled status-2 ShellResult, so they remain failures here.
Root public integration remains **HOLD**, independently pending the other
owner's Arch v2 review and root-owned integration work.

## Authentication and package

Before product imports, the full candidate and all required ancestors matched:
`f8819e9d6b6d535b0626e0aa004bb10a7bc36785`,
`a809635432f18a235b8fb622a05367bedc54b315`, and
`04644bc2c15d67155f5f4b170a66fc9bef3f6e3d`.
The required input blob `3eec71b72f87dd48ddac572d6e7feb9097d32be4`,
column tree `8b32998383d1372a8624ac41d2e747551e5b6d4c`, and alias tree
`5e8ac069bfa6ead7a337130457cd6519f2066e2c` matched exactly. Column identity
authentication is not column verification; no column tests or edits were made.

The **whole** Git candidate was archived without filters or overlays: 27,687
Git entries, including 27,675 regular files and 12 historical data symlinks.
Every Git blob and complete file membership was authenticated. Symlink target
bytes were checked without traversal; all product files are regular files.
After build, before and after both cohorts, and after diagnostics, complete
source/package inventories detect **new entries as well as changed/deleted
entries**, including directories and symlink targets. Reused dependency trees
were separately checked, so the three development symlinks are not blind spots.

- Whole archive SHA-256: `64fac38e43ce89009e03d24b8b3dffb8425dd98a313bea4d4133d6db8030cccf`.
- Offline package SHA-256: `62228b67ca6793544f0f4374ca00fbbb6e627f514f184d5880fd7723ccf179c6`.
- Alias source SHA-256: `c2333d21c049651a3ef75f811f7c3f516a364d41fdbed2f3683388fba0adbcff`.
- Input source SHA-256: `4214a448a1a076acb297c3ba6a02d72482d488cf8b6df4549498148a012e5c32`.
- Actual packed worker SHA-256: `bb568433f1194d957dd14d1eb8229e9733bd13cd42db7ca5f2ac77b5f739b8f7`.

Build and both strict scoped consumer compilations pass on Node v22.22.2 Darwin
arm64. The actual command was `npm pack --offline --ignore-scripts --json` with
an isolated cache/home; the extracted package was physically renamed into an
independent consumer. Runtime dependencies remain empty. TypeScript 5.9.3,
@types/node 22.20.1 and undici-types 6.21.0 were reused read-only after candidate
lock integrity, cached tarball digest, installed version, full file membership,
bytes and mode checks. Nothing was installed. Live repository movement and
unrelated untracked files were context only, never product inputs.

## Exact denominators and unchanged inputs

| Cohort | This candidate's actual result |
| --- | --- |
| Base subcases | 75 pass / 2 fail / 77 executed |
| Original native-profile rows | 26 / 26 qualified-profile passes |
| Original safety groups | 11 pass / 1 fail / 12 executed |
| Original native + safety groups | 37 pass / 1 fail / 38 executed |
| Additional alias-adversarial subcases | 9 / 9 pass |
| Separate public registered-grep control | 1 executed, failed |
| Supplemental S02/S03 subcases | 5 / 5 pass |
| Combined subcases, excluding group parents | 80 pass / 2 fail / 82 executed |

The original holdouts, public consumer, supplemental holdouts, all fixture bytes,
all assertions and all native captures were reused unchanged from the archived
candidate. The two original runner files were copied externally; only resource
roots were rebound, plus the supplement's hardcoded old candidate metadata was
replaced with the pack receipt's candidate. `execution.json` records each exact
replacement; byte-level inversion is checked by `verify.mjs`. No assertions were
changed, skipped or retried. Historical evidence commits
`7550a317c699392867d5a779058039e7fc0d9f1e` and
`a8b1c7d25bb209a91767e369a0fa297b40de0551`, the original `28a8ad15` seal,
GNU seal and all historical failures/harness corrections remain unchanged.

Standalone registration, malicious grep bypass, collision/replace, shared worker
limits/cancellation, structural context forwarding, direct/owned VFS cleanup,
registered cleanup/dispose barriers, late errors, backpressure, cumulative
budgets and complex pipelines are the original executed controls, not inferred
coverage. The supplement still uses its separately disclosed larger queue only
to isolate the pipeline output budget. No stronger column S38 expectation was
introduced into alias fixtures; opaque unregistered work is not promoted to a
registered-cleanup guarantee.

## The two disagreements, without rewriting history

`S07/borrowed-external-Shell-stdin-return-rejection-not-waived` executes
`egrep -q keep`. `ROOT-CONTROL/public-registered-grep-reproduces-external-return-failure`
executes public registered `grep -q keep` without aliases. Both producers return
`keep:01\n` from `next()` and reject `return()` with their sentinel Error.
The unchanged tests await a fulfilled result, then require exitCode 2 and a
sentinel-containing stderr. On this candidate the await **rejects** instead:
`external-return-sentinel` and `shared-grep-return-sentinel`, respectively.
The original 04644bc2 rows failed after a fulfilled status-0 result; those raw
historical rows remain intact and are not relabeled as current observations.

Two separate bounded diagnostics repeat only these existing failures. Each
observes the **same Error object**, one `next()`, one `return()`, no VFS files,
and zero workers after disposal. They are diagnostic observations, **not two
additional product passes**. Rejected exec has no returned ShellResult; the
diagnostic's null stdout/stderr/status fields explicitly mean unavailable,
not fabricated empty output. Full exceptions and raw TAP remain in the attempt
receipts. This supports the root's error-propagation diagnosis, not a claim that
the original fulfilled-status assertion passed. No shared-source change is
requested to force that assertion. Root must resolve the assertion/API boundary
separately before claiming a green unchanged cohort; all old rows stay immutable.

## Profiles, workers and process closure

Only historical BSD/GNU captures were compared: BSD exact raw tuples **16/26**;
GNU exact raw tuples **0/26**; GNU stdout/status/VFS projection **26/26**.
No deprecation warnings were stripped. The projection deliberately excludes
stderr and is not native parity. Six diagnostic/unsupported-option profiles and
four E/F-conflict profiles remain qualified rather than exact BSD matches.
These are Darwin C-locale references, not GNU/Linux evidence or new native runs.
GNU archive/keyring/signer trust qualifications remain in the unchanged native
prerequisite and capture records; no new native child or oracle capture ran.

Base workers: **86 created / 86 exited**. Supplement: **5/5**. The two diagnostics:
**2/2**, separately counted. All **93** actually observed workers exited with
zero active workers, late unhandled errors or verifier terminations. Every create
URL resolves to the authenticated moved package's worker, whose complete package
bytes were checked before/after. Product-owned worker retirement is expected;
an exit code from product termination is not verifier forced cleanup. The base
trace's `threadId` is its historical observer identity, not an OS thread ID.
The static checker's missing-exit/wrong-worker negative controls use copies of
these actual traces and are tools-only, not product passes or mutant runs.

Base child exit status is **1**, solely retaining the two assertion failures;
supplement and diagnostic child statuses are **0**. No timeout, signal, leaked
worker or forced cleanup occurred. The original 120-second base, 30-second
supplement and 5-second subcase bounds remain; diagnostics use a 15-second outer
bound. Source work and owned workers are stopped. No whole gate or benchmark ran.

## API and receipt use

Runtime imports use **public root Shell** and the **packed internal alias URL**.
No alias public subpath exists in this candidate; none is claimed. Internal API:
`createGrepAliasCommands`, `grepAliasCommands`, `egrepCommand`, `fgrepCommand`,
`GrepAliasOptions`. Options are `regex` and `replace`; plugin collision preflight
defaults to no replacement and never registers grep. Aliases inject initial
`-E`/`-F`; mixed E/F flags conflict, and G remains unsupported by shared grep.
They add no new matching capability or dialect-completeness guarantee.

The main profile uses maxWorkers 1, maxQueuedRequests 1, maxQueuedBytes 4096,
request/startup timeouts 1500 ms and idle timeout 1000 ms. The pathological ERE
control uses 75 ms. Supplemental output-budget isolation uses queue 64/65536 and
output limit 6144. Worker memory/stack option existence is not independently
memory-exhaustion-qualified here. Family queues are not a shared Shell budget.

`attempts/prepare-01` preserves the sole failed preparation and exact verifier
source: build/pack passed, but the verifier guessed `grep/index.js` instead of
`grep.js` while checking load bindings. No product imported. Regex client path
was also corrected before the second preparation. The second whole archive and
pack have identical archive/package hashes. There was only one base and one
supplement product attempt. No failure was overwritten or hidden.

`attempts/prepare-02/receipt.json` retains raw build/pack command outputs but
projects the large Git listing and file manifests into hashes/counts; the full
transient receipt and whole candidate recover them. This projection omits no
product output. `source-receipts.json` authenticates byte-for-byte exported raw
results and the unchanged source copies. All complete Git manifests/baselines
remain in the isolated snapshot identified by `summary.json`.

Explicit opt-in reproduction, not canonical test discovery:

```
node tests/commands/grep-aliases-stress/final-shared-replay/replay.mjs prepare /tmp/NEW-UNIQUE-ALIAS-REPLAY
SAFE_BASH_APPLY_PATCH="$(command -v apply_patch)" node tests/commands/grep-aliases-stress/final-shared-replay/replay.mjs run /tmp/NEW-UNIQUE-ALIAS-REPLAY
node tests/commands/grep-aliases-stress/final-shared-replay/replay.mjs check /tmp/NEW-UNIQUE-ALIAS-REPLAY
node tests/commands/grep-aliases-stress/final-shared-replay/verify.mjs --retained-snapshot
```

The final command audits this recorded evidence, not a newly captured run;
without `--retained-snapshot` its static receipt checks require no temporary
product files. All captures go to fresh temporary directories and never rewrite
committed evidence. Resume thread: `01a04392-fd24-7870-a9d4-abfdce728e4d`.
