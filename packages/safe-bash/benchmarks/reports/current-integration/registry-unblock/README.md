# Registry unblock — independent bounded execution

## Verdict and exact accounting

**The registry preflight obstruction is removed for all original 99 identities.
The workflows are not wholly green: 97 pass, 2 fail downstream.** No cases were
removed, renamed, skipped, cancelled, marked TODO, or given weaker expectations.
This is a fresh dirty-source checkpoint, not committed-source validation and not
a revision of the accepted historical report. Ready for review; **not committed**.

| Original cohort | Unique | Pass | Fail | Skip / TODO / cancelled | Exit |
| --- | ---: | ---: | ---: | --- | ---: |
| Adapter matrix | 79 | 77 | 2 | 0 / 0 / 0 | 1 |
| Typed/error/namespace diagnostics | 8 | 8 | 0 | 0 / 0 / 0 | 0 |
| Fresh jq interoperability | 6 | 6 | 0 | 0 / 0 / 0 | 0 |
| Split jq interoperability | 6 | 6 | 0 | 0 / 0 / 0 | 0 |
| **Historical selection** | **99** | **97** | **2** | **0 / 0 / 0** | **not green** |

All four entrypoint files are byte-identical to the historical frozen files;
all 99 exact file/name identities match accepted nonpass TAP identifiers.
`execution/accounting.json` gives each identity, old/new status and raw TAP line.
No preflight failure remains in this execution. The two failures have stacks
inside the real callback at `tests/integration/adapter-tools/matrix.test.ts:105`.
Passing callbacks retain their status, byte, namespace, dispatch, cancellation,
output-limit and supplied/piped/explicitly-empty-stdin assertions. Eight decoded
diagnostic callback records are retained in `execution/diagnostic-callbacks.json`.

| Backend | Pass | Fail | Total |
| --- | ---: | ---: | ---: |
| memory | 15 | 0 | 15 |
| real | 14 | 0 | 14 |
| S3 mock | 13 | 1 | 14 |
| loopback WebDAV | 13 | 1 | 14 |
| mount | 15 | 0 | 15 |
| overlay | 15 | 0 | 15 |
| readonly | 12 | 0 | 12 |

The original 99 preflight failures remain historical observations, not deleted
failures. The accepted full suite remains 9,920 = 9,686 pass + 164 fail + 70 skip.
Its **42 separate jq differences remain OPEN**; these twelve interop rows neither
rerun nor close them. No full suite, comparator, tar gate or wider jq gate ran.

## Frozen provenance and independent isolation

Sealing began **2026-08-27 00:37:13.068 UTC** (August 26 evening, Chicago).
Source anchor: **DIRTY `5076b32dee1b8ca6d1ed757216f3f5bed17cb379`**.
Selected-input SHA-256:
`d779b4b516275895677f05c5011cf7c39e8252eda7686fecdcaa453a56920e91`.
Product `src/` SHA-256:
`6c24d112b9ec65b660f2fc8131d97e0bb03023d7f8de4bdd212612c75e5f89da`.

`execution/sealed-input.json` records 1,276 selected regular files (17 untracked),
839 exclusions, all dirty paths, HEAD/index state, full selected file hashes and
identical before/after sealing inventory/state. Copy verification rejected source
symlinks, hardlinks and changed hashes. Excluded report/dependency/git/generated
trees, fixture debris and unexecuted snapshot runners were not execution inputs;
their names/reasons, not their excluded bytes, were captured. Relevant untracked
source was copied, not selectively replaced by committed files.

Retained workspace, created by the host temporary-directory facility:
`/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-bash-registry-unblock-or9etxak`.
Its `source/` is the baseline regular copy; `mutation-source/` is a second regular
copy. macOS resolves this host path under `/private/var/folders/`; neither path
aliases the live source checkout. `aux/` holds frozen verifier input copies;
`environment/` holds private per-phase HOME/TMP/XDG/npm caches. Retained `dist/`
is generated build output, not input. No dependencies or source are vendored into
this report. The early root checkpoint is
`/tmp/safe-bash-registry-unblock-checkpoint.txt`.

Both snapshot input manifests remain identical after tests, mutations and build.
The mutation plugin changes only an isolated in-memory registry; no original
test file or product source was patched, even in the mutation copy. Verifier
harness/config additions are explicitly under each copy's `audit/` directory.
Later live HEAD/source changes are recorded separately in `execution/after.json`,
`execution/supplement-after.json` and `execution/final-verification.json`; they
were **not** refreshed into either tested snapshot.

Author handoff bytes match ancestor commit
`98498c121d14adb75d24b72908ff1ae24576aaac` for fixture/helper/30 controls and
`7d0fe7b45578cfc3836e9a8d6a5fd4a4d5e9edd3` for the two registry assertion files.
The four historical entrypoints and four supporting expectation/data files
remain byte-identical to the accepted frozen baseline. The new helper requires
22 literal command capabilities; it does not compare the registry cardinality.

Accepted evidence commit `96db59ac7d355d1a94422634b4c4f53d00932ad9` remains immutable:
all 94 parent manifest entries and the manifest's committed bytes were verified.
Its source anchor remains **DIRTY `57d9d9860bd51fabd910814efeea4efbca0e4c26`**,
digest `5905112264b83a5e12ca549eec5a88d90f956b2838d54095e97bcec545c91560`.
Neither evidence commit is a claim that the audited dirty tree was committed.
`PREPARATION.md` and its five-entry manifest retain the earlier, then-gated state;
their “not run/no handoff” labels are historical, superseded for this execution.

## Independent mutations and separate controls

All counts below are **nonadditive to the original 99**, with no skips, TODOs,
cancellations, signals or timeouts. All phases exit 0 except matrix79 (exit 1).

- Standalone literal-52 factory/installed-registry probe: **1 successful process**.
- Curie's two exact selected registry tests: **2/2 pass**; not the full two files.
- Poincare's author preflight controls, independently rerun: **30/30 pass**.
- Independent cardinality-preserving missing-command mutations: **154/154 pass**
  (22 commands × seven backends). Each removes exactly the named command, inserts
  an executable uniquely named substitute, checks cardinality remains 52, observes
  the exact named missing-family/command assertion and proves callback entry false.
- Independent optional addition: **7/7 pass**, cardinality 53, one per backend.
  Each proves callback entry, optional command execution, exact `cat` bytes,
  find→xargs→rg→sed→awk→jq→jq pipeline output, gzip pipe roundtrip, diff result and
  dispatch identities. This is real workflow behavior, not only green preflight.
- Independent literal required-name contract: **1/1 pass**, comparing the helper
  with a separately authored literal list. Total independent TAP cohort: **162**.

The independent literal required list is `cat cp find mkdir mv printf pwd rm
rmdir sort tee test touch xargs sed awk jq rg sha256sum gzip diff patch`.
`expected-default-commands.json` independently pins the exact 52 default names;
neither oracle is derived from the registry/helper under test. Exact runtime
transforms and callback/diagnostic records are in `independent162.stdout` and
`execution/accounting.json`. The original preparation's representative-cat plan
was expanded to every required command/backend because the full bounded run was
fast; no representative-only reduction was needed. The 99 workflows were not
rerun 22 times: mutations intentionally stop before their callbacks.

## Commands, dependencies and environment

Execution commands are recorded as actual argv/cwd arrays in
`execution/sealed-input.json` and each phase's `*.environment.json`. The four
workflow commands share:
`node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 --test-reporter=tap --test-name-pattern=<anchored exact historical names> <cohort file>`.
The complete regex strings, without ellipses, are in the sealed input. They select
79/8/6/6 names; Node reported exactly those identities, no filter skips.
The registry-author2 selection omits the other 27 test instances in its two files;
those are not counted as skips or claimed covered. Author30 and independent162
execute their complete respective control files.

Reproduction orchestration is `python3 execute.py freeze`, `python3 execute.py run`,
then `python3 execute.py supplement`, from this report directory or with its full
path. The executor refuses an existing evidence directory/phase-results file;
do not overwrite this accepted candidate. A future run needs a newly owned report
directory and must revalidate handoff bytes/locks against its own current state.
The 900-second global deadline begins at sealing; per-phase bounds are 240/120/
120/120 seconds for the four cohorts, 30/40/60 for registry/control phases, and
240 for independent162. All test phases finish within 22 seconds of sealing;
supplementary checks finish within 90 seconds. Each child has its own process
group, TERM/KILL timeout cleanup and private allowlisted environment. No watch
processes or child groups remain; no `.real-*` fixture debris remained to clean.

Root **`npm run build` passes**, exit 0, 1.921 seconds. Its actual package script
is `tsc -p tsconfig.build.json`. Scoped source/cohort/control typing passes,
exit 0, 1.245 seconds:
`node node_modules/typescript/bin/tsc --noEmit -p audit/scoped-tsconfig.json`.
This is **not** the full `npm run typecheck` or `npm test`. The frozen actual full
package scripts are captured, not substituted by claims about these scoped runs.

Node is **v22.22.2**. Installed root dependencies were copied from the previously
verified retained snapshot into each new private `node_modules`: **314 regular
files**, only four relative internal `.bin` links, no workspace/live-source links.
Manifest and lock hash match accepted locked versions; installed package versions,
resolved/integrity metadata and every copied file hash match. All 314 original
and both reused-copy hashes match again after execution. Root lock SHA-256:
`9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b`.
No install or external network occurred. Installed bytes were not independently
re-extracted from npm tarballs; platform-inapplicable optional packages remain
absent. No just-bash dependency/comparison was used; its historical pinned evidence
is unchanged, not replaced by a newer comparator.

New per-phase environment captures are **CONTEMPORANEOUS immediately before
spawn**, distinct files never backfilled as an initial capture. Historical parent
initial environment data remains **INFERRED/RECONSTRUCTED**, not retroactively
made contemporaneous by this follow-up.

## Limitations and owner handoffs

Poincare: keep both remaining exact identities open:
`s3: create, copy, append, inspect and remove files` and
`webdav: create, copy, append, inspect and remove files`.
After successful mkdir/copy/append/read/find assertions, the unchanged callback
runs `rm scratch/nested/copy.txt && rmdir scratch/nested && rmdir scratch && test ! -e scratch`.
S3 returns `ENOTSUP: S3 object deletion cannot atomically require an empty directory prefix`;
WebDAV returns `ENOTSUP: rmdir has no safe portable WebDAV equivalent`, both for
`/work/scratch/nested`. See raw `matrix79.stdout:159` and `matrix79.stdout:246`,
frozen `src/fs/s3/filesystem.ts:509`, `src/fs/webdav/webdav.ts:480`, and unchanged
matrix source line 105. These are unsupported safe-empty-directory gaps, not
registry failures and not justification for an unsafe recursive fallback or skip.

Curie: the exact-52 contract and named capability gate pass on this sealed source;
later live registry/export edits are outside this checkpoint. Archimedes/root:
the separate 42 jq differences remain open; this twelve-row interop result does
not independently validate later jq fixes. FS commit `59b1269` evidence
515/515, alias53/53 and frozenpositive23/38 versus moving28/38 is **attributed
user/author evidence only**, not independently rerun or folded into our totals.

S3 uses a mock, WebDAV a local HTTP fixture, mount/overlay the supplied fixture
composition. This does not establish real-provider interoperability, remote
permission enforcement, universal shell support, metadata/tar/curl parity or
superiority over just-bash. Native expectations in the twelve jq rows and eight
diagnostics come from retained frozen JSON/reference data, not fresh native-oracle
execution. Conditional private-engine/oracle suites were not selected or run.

Static closure review covers the executed entrypoints and their conservative
import/export closure (including type-only edges); checked literals resolve within
the regular snapshot, with no non-builtin bare source imports or computed import
expressions found in that checked closure. A separate closure checks the mutation
harness. **No universal computed-import/no-live-alias claim is made.** Unexecuted
`tests/shell/first-read-independent.snapshot.mjs` and
`tests/shell/first-read-guard.snapshot.mjs` contain known live-root aliases and were
explicitly excluded. No inference about their execution is included.

The read-only review in `REVIEW.md` accepts the static handoff delta; review of
these fresh execution/mutation artifacts is still pending. Stop here for root
review before any explicit-owned-path commit. No source fixes, staging, commits,
branches, live fixture edits or private repository access were performed.
