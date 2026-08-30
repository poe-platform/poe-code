# Independent eight-case diagnostic audit — August 26, 2026

## Verdict: legitimate wording change; coverage NOT PASS

The eight human-readable shell diagnostics are legitimate under the authorized
contract: Bash-style human stderr plus separately verified exact typed filesystem
errors. The user did not require literal errno tokens in CLI stderr. Independent
execution proves the intended behavior in all eight rows, both on pinned source
`19149d3` and on the recorded current working tree. This does not make an
insufficient matrix sufficient retroactively.

The wording-only revision `d0fed8f` lacks typed boundary checks, exact redirection
status/stdout checks, and missing-input namespace/byte checks. It is **not a pass**
for the authorized combined contract. The later `df5bc45` substantially strengthens
the matrix, but its append row checks `appendFile` rather than the operation
that actually rejects: `writeFile(path, emptyBytes, { flag: "a" })`.

This is a demonstrated coverage gap, not a speculative demand for more tests:
`check-coverage.mjs` injects an ordinary `Error` carrying the correct `code` and
`path` only for readonly append-open, in the test loader's memory. It does not
change source files, bytes, other adapter methods, or matrix assertions. The
unchanged `df5bc45` append row **passes 1/1**, with the correct CLI message/status
and preserved bytes. Independent acceptance **fails 0/1**, specifically on
`FsError` identity in the observed and directly invoked append-open operation.
`appendFile` still returns a valid `FsError`. See `coverage.json` for complete TAP
and exact invocation. The coverage command deliberately exits **1**.

**Owner handoff: Poincare/matrix owner** should add a direct rejection assertion
for `writeFile("/work/target.txt", new Uint8Array(), { flag: "a" })`, with
`instanceof FsError`, exact `EROFS`, exact path, and unchanged namespace/bytes.
Retain the existing `appendFile` check. Re-run the mutant and baseline gates.
No product defect was found in the eight unmutated flows; no source fix is
requested or made. Root coordinates this handoff.

## Revision and assertion mapping

| Revision | Full commit | Matrix Git blob |
| --- | --- | --- |
| Original | `6a259ff4c38f64efb506e39812166ff7f003f6ce` | `0b5abee4b9bf65590085c96d83eb599b50595523` |
| Shell diagnostic source | `19149d3d9c5dc6f309b61f215a140df18adaf6e4` | same original blob |
| Wording-only matrix | `d0fed8fb1b54ae7be4dadc1332750314d9bb108d` | `5ff401c166b0142641cbe045b87162ee125db532` |
| Typed-check matrix | `df5bc453de004a8eb483696cf4ae1986a012cca1` | `f007991b74b780e6aeb5fc4e8e570b1a18379528` |

Important correction: `19149d3` changes shell source, **not these eight matrix
assertions**. Its matrix and fixture blobs are identical to `6a259ff`. The actual
expectation edits occur later in `d0fed8f`, then additional checks in `df5bc45`.
No matrix cases were added/removed by these two diagnostic revisions.

At original matrix line 146, one `/ENOENT.*missing\.txt/` assertion expands into
six backend rows. Wording-only line 146 replaces it with exact human stderr.
Strengthened lines 146–157 require status 1, empty stdout, exact stderr, unchanged
`/work` tree, and `access(4)`, `readFile`, `stat` rejections. At original line 282,
the `/EROFS/` assertion expands into nine mutation rows; **only the two printf
redirect rows change**. Wording-only line 283 adds their exact string branch.
Strengthened lines 295–303 add status/stdout and one typed mutation per row.
The other seven mutation assertions remain untouched. The helper at strengthened
fixture line 201 checks actual `instanceof FsError`, code, and path.

Original ENOENT checks only required nonzero status, no redirect stdout or byte
invariant. Original readonly checks already compared the complete `/work` tree
and important file bytes; these are preserved. The strengthened matrix adds 20
typed boundary invocations: 18 ENOENT and two EROFS. It does not cover the actual
append-open operation's type, as the negative control proves.

The user-supplied **original 71/79** and **revised 79/79** are different historical
cohorts. Neither full cohort was rerun here; the original is never relabeled
accepted. In particular, 71/79 is not asserted to be execution of the source tree
at the original matrix's creation commit. This audit's denominators are eight
targeted cases per source snapshot, not 79.

## All eight independent results

`N` is exactly `shell: line 1: missing.txt: No such file or directory\n`.
`R` is exactly `shell: line 1: target.txt: Read-only file system\n`.
All rows require exit **1**, exactly empty stdout, and the indicated exact stderr
bytes. Both source cohorts pass every unmutated row.

| Row | Original assertion → df5bc45 assertion | Actual rejecting operation | Exact boundary | CLI | Bytes/namespace | 19149d3 / current |
| --- | --- | --- | --- | --- | --- | --- |
| memory missing input | 146 → 148 | `access(missing, 4)` | `FsError`, `ENOENT`, `/work/missing.txt` | N | preserved | PASS / PASS |
| real missing input | 146 → 148 | `access(missing, 4)` | `FsError`, `ENOENT`, `/work/missing.txt` | N | preserved | PASS / PASS |
| S3 missing input | 146 → 148 | `access(missing, 4)` | `FsError`, `ENOENT`, `/work/missing.txt` | N | preserved | PASS / PASS |
| WebDAV missing input | 146 → 148 | `access(missing, 4)` | `FsError`, `ENOENT`, `/work/missing.txt` | N | preserved | PASS / PASS |
| mount missing input | 146 → 148 | `access(missing, 4)` | `FsError`, `ENOENT`, `/work/missing.txt` | N | preserved | PASS / PASS |
| overlay missing input | 146 → 148 | `access(missing, 4)` | `FsError`, `ENOENT`, `/work/missing.txt` | N | preserved | PASS / PASS |
| readonly truncate | 282 → 297 | `writeFile(target, empty, w)` | `FsError`, `EROFS`, `/work/target.txt` | R | no truncation/creation | PASS / PASS |
| readonly append | 282 → 297 | `writeFile(target, empty, a)` | `FsError`, `EROFS`, `/work/target.txt` | R | no append/creation | PASS / PASS |

The corresponding failing calls are observed transparently on the **actual
adapter instance**, forwarding original arguments/result/error without replacing
the backend or fabricating errors. Observation assertions run after shell
execution. No command dispatch occurs after failed redirection. Separate direct
calls verify the same operation; ENOENT additionally checks readFile/stat, and
EROFS additionally checks writing/append of `changed`. Per cohort this is **eight
observed failures plus 22 direct typed rejections**, not merely parsed CLI text.
Low-level syscall labels differ legitimately: S3 delegates to `stat`, WebDAV to
`PROPFIND`, overlay to `overlay`; requested adapter operation and virtual path are
checked separately and actual syscall labels recorded.

The original prelude `cat missing.txt 2> error.log` is retained in all six ENOENT
rows. Its status is 1; stdout/stderr are empty; its exact utility-dialect bytes
are checked in `/work/error.log`. This one diagnostic file is the **only allowed
namespace/byte change** from the seeded state. The subsequent input-redirection
and every direct rejection must preserve it and every other file. Snapshots cover
`/`, including mount's `/objects`, not only `/work`; overlay lower is separately
compared. No missing input is created. `target.txt` always remains hex
`616c7068610a626574610a` (`alpha\nbeta\n`). Entire file contents, not just these
sentinels or lengths, are compared. Snapshot hashes and exact stream/log hex are
in `final-results.json`; metadata timestamps are intentionally not byte invariants.

## Frozen native/reference provenance

`reference.json` SHA-256:
`c62e4e68b6c2d79ce6e88ce958cc7df37a5b2cfa306d9779e0ba48f7f55039b4`.
Tests hard-pin this hash. It was created **before any product comparison**.

Native executable: `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA-256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`;
GNU Bash `5.3.0(1)-release (aarch64-apple-darwin25.4.0)`.
The fresh capture uses argv0 `shell`, `LC_ALL=C`, `LANG=C`, `TZ=UTC`, controlled
PATH, no inherited shell startup environment, and literal argv
`--noprofile --norc -c 'cat < missing.txt'`. There are **zero normalizations**.
Exact argv, executable/version, cwd, status, stream hex, and empty before/after
namespace are frozen. Native execution is bounded to 3 seconds/16 KiB and isolated
under this owned directory. No external command runs after failed redirection.

EROFS was **not induced natively**. No safe read-only filesystem was available
inside the owned temporary directory. No chmod, privilege change, remount,
external host mutation, or EACCES stand-in was used. The readonly vector is a
clearly labeled **GNU Bash 5.3 + glibc 2.42 C-locale primary-source profile**:
upstream Bash `redir.c` line 223 renders filename plus strerror; `execute_cmd.c`
lines 4969–4973 maps redirection failure to EXECUTION_FAILURE; `shell.h` line 52
defines that as 1; glibc `sysdeps/gnu/errlist.h` line 200 supplies the EROFS text.
Source URLs, release tags, fetched-content SHA-256 hashes, and minimal excerpts
are frozen in `reference.json`. The Bash prefix is executed in the native
ENOENT case. This is a source-derived readonly vector, not a Darwin-libc EROFS
capture or universal dialect claim. EROFS is never confused with EACCES.

Successful reference generation makes **two native calls** (version and ENOENT),
reused across the six backends, not six independent native captures. An initial
capture attempt also made those two calls before rejecting an incorrect source
excerpt search; it wrote no vector. Thus this audit made **four total native
Bash calls**, zero native EROFS calls. Acceptance and mutation runs make zero
native Bash calls; the pinned loader's git subprocesses are not native oracles.

## Reproduction and validation

From the repository root, using existing tooling only:

```sh
node tests/integration/adapter-tools-diagnostics/run.mjs rerun.json
node tests/integration/adapter-tools-diagnostics/check-coverage.mjs coverage-rerun.json
```

The first command runs the eight cases on current source, then pinned `19149d3`,
and strict scoped TypeScript checking of the test plus its imported implementation
graph. It records exact argv, versions/hashes, results and source drift through
`apply_patch`. The second is an intentionally failing coverage gate (exit 1),
recording the one-row counterexample. Choose a new output basename for diagnostic
reruns; scripts refuse to overwrite evidence. The loader changes
only the original fixture's host temp-root expression to point inside this owned
directory. All assertions and adapter/tool setup remain unchanged. Pinned source,
fixture and WebDAV mock are read from Git into memory and transpiled with existing
TypeScript; no shared files, branches, index entries or working trees are changed.

Final `final-results.json` (Node v22.22.2, 2026-08-26 21:47:30 UTC):

- Current: **8 tests, 8 pass, 0 fail/cancel/skip/TODO**, exit 0, 1.154 s.
- Pinned 19149d3: **8 tests, 8 pass, 0 fail/cancel/skip/TODO**, exit 0, 3.857 s.
- Strict scoped typecheck: **exit 0**. Five helper `.mjs` syntax checks: exit 0.
- Mutation: unchanged revised row **1/1 passes**; independent row **0/1 fails**;
  no skips/cancellation/TODO. Combined coverage verdict: **NOT PASS**.

Final current HEAD was `d0bf4ce6ccd4240fe937255a6b6a9676e535ff4e`; working-tree
implementation plus original fixture/matrix/mock manifest (101 files) SHA-256
`2961ff3d72326f66658a6bf83089fedd1024609a7a6548fd086fa7f9778cdff0`.
This is not represented as a clean commit-only execution: concurrent workers
have source changes. Per-file key hashes are recorded, with **no source changes
during either final run or the final session**. Pinned source tree is
`68f8d800dcc23da445c9586c863af8c7d56e4d3a`. Matrix/fixture SHA-256 and Git blob IDs
are recorded separately. The mutation proof uses pinned source 19149d3 with exact
matrix/fixture df5bc45, independent of concurrent edits.

Harness calibration is not hidden: the first exploratory current run was 7/8
because an auxiliary **unchanged command-prelude** diagnostic regex incorrectly
assumed filesystem wording for WebDAV's HTTP 404 diagnostic. Inspection of the
WebDAV HTTP-error mapping and command diagnostic formatter established its exact
`cat: ENOENT: WebDAV HTTP status 404, PROPFIND '/work/missing.txt'\n` profile.
That regex was replaced by **stricter backend-specific exact equality**, including
operation and path; none of the eight frozen shell expectations changed. An
attempt to collect the same run then failed JSON parsing due to TAP escaping;
machine records now use base64 inside TAP. The pre-final successful 8+8 run is
retained in `results.json` with its earlier test/loader hashes; final acceptance
uses the transparent observer and loader hashes in `final-results.json`.

Scope stays at eight diagnostics and one focused coverage counterexample: no
original matrix/fixture, shell, FS, jq, AGENTS, root docs/config or other worker
file was edited. S3 is mock and WebDAV loopback, not production-provider proof.
This is not full-shell validation, broad compatibility, a 72-hour claim, or
evidence of superiority over just-bash. Stop at this checkpoint; no source fix.

## Quick closure — SPECIFIC GAP CLOSED (August 26, 2026)

Independent three-row verification recorded at **2026-08-26T22:09:21.706Z**
reviews Poincare's **`33ddb70c75865e3e695cf471b942ab0add98a891`**. The earlier
NOT PASS verdict and owner handoff above remain the historical audit of
`df5bc453de004a8eb483696cf4ae1986a012cca1`, not the corrected assertion.

| Pinned matrix / control | Pass | Fail | Exit |
| --- | ---: | ---: | ---: |
| df5bc45 + unchanged append-untyped mutant | 1 | 0 | 0 |
| 33ddb70 unmutated baseline | 1 | 0 | 0 |
| 33ddb70 + identical append-untyped mutant | 0 | 1 | 1 |

Each invocation executes exactly one append-redirection row, with zero skipped,
cancelled or TODO cases. The corrected mutant fails specifically with
`filesystem boundary must reject with an actual FsError` (`ERR_ASSERTION`,
expected true, actual false). This expected negative-control failure closes the
demonstrated identity gap; it is not an unmutated product failure.

All three rows use identical committed production source
**`19149d3d9c5dc6f309b61f215a140df18adaf6e4`**, source tree
`68f8d800dcc23da445c9586c863af8c7d56e4d3a`, and identical fixture bytes. The
helper verifies that removing exactly the seven added assertion lines makes the
corrected matrix byte-identical to the old matrix. The actual shell append-open
uses `writeFile(path, new Uint8Array(), { ...options, flag: "a" })`. The new
direct empty append-open assertion retains the existing `appendFile(changed)`
assertion. Both require `instanceof FsError`, exact `EROFS`, and exact
`/work/target.txt`; full `/work` namespace/byte snapshots, target/old/payload
bytes, status, stdout and exact human stderr checks remain intact.

`append-closure.json` freezes full commit/blob/SHA-256 identities for source,
both matrices and fixtures, the exact assertion diff, tooling, argv/environment,
complete TAP, outcome mismatches (none), and before/after protected-file hashes
(no drift). The loader's sole change admits the corrected matrix revision; its
mutation block is byte-for-byte identical to audit
`d5ac96afd5288234de3b617bc15af3b2a3c42bf5`: only readonly `writeFile` with flag
`a` throws a plain `Error` with correct `EROFS`/path. No source or original
matrix/fixture files were changed. All prior repro artifacts, including
`coverage.json`, remain byte-identical; the old coverage gate still defaults to
the old revisions and its original expected failure behavior.

Reproduce only these three rows, with a new evidence filename:

```sh
node tests/integration/adapter-tools-diagnostics/check-append-closure.mjs append-closure-rerun.json
```

Existing dependencies only; each child is bounded to 30 seconds and 1 MiB per
output stream, with SIGKILL on deadline. Temporary/cache paths are isolated
inside this owned folder and removed in `finally`. No native oracle, install,
full eight/79-case run, fuzzing or remote/cancellation validation occurs. Both
helper and loader syntax checks passed. The original **71/79** and revised
**79/79** remain distinct **HISTORICAL** cohorts: no retroactive original
acceptance, fresh 79/79 claim, or universal cancellation/full-matrix acceptance.
