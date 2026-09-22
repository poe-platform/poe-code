# Independent htmlq qualification

## Manual QA procedure

1. Identify the final working-tree candidate by HEAD and a sorted path/content
   SHA256 receipt; preserve all unrelated changes. Follow the package pattern at
   `archive/safe-bash-command-package-pattern.md`, moved by pre-existing edits.
2. Execute saved Q01–Q18 in
   `packages/safe-bash-command-htmlq/src/independent-fixtures.ts`. Literal input,
   argv and expected stdout are encoded in TypeScript strings; input has no
   implicit final LF. Compare complete UTF-8 bytes. Product engine uses whole,
   one-byte and seven-byte input chunks. CLI must return status 0, empty stderr,
   exact bytes, unchanged source and no created files.
3. Build native htmlq only as an isolated development control from commit
   `bfcb1d1d11a80fdd92c0dace1e7e559fbdb225cb` with Cargo `--locked --release`.
   Verify locked dependency checksums against the research pin. Execute every
   saved fixture using literal argv, stdin bytes and captured stdout/stderr/status.
   Never import native tools or external parsers into the command runtime or
   invoke them from unit tests. Record differences rather than rewriting expected
   results to match the candidate.
4. Execute memory-VFS Shell controls for extraction through sort/uniq and jq,
   typed SDK equivalence, protected same-file output, quota rollback, concurrent
   publication, denied host/network authority and pending-read cancellation.
   Run package unit/lint and the maintained selected safe-bash build closure.
5. Inspect a screenshot of the actual Shell pipeline and selector diagnostic,
   using the maintained generic screenshot route (htmlq is an opt-in Safe Bash
   command, not a top-level poe-code command). No screenshot unit tests.
6. Record versions, candidate receipt, passes/failures/skips/missing cells and
   parity exclusions. Performance measurements are separate and prove no
   semantic claim. Purge task-owned transient source/build/log/PNG evidence.

`/out` is read-only on this host; task-owned temporary evidence uses ignored
`out/htmlq-qualification`. Native controls are manual QA; tests use only memory
streams/VFS and mocked capabilities. No standalone command publication is
authorized.

## Executed receipt — 2026-09-21

Candidate HEAD: `ab1fa8d34101e1e7f61272973f3bc28a842043d8`, with pre-existing
uncommitted implementation/integration and unrelated edits preserved. Candidate
source/check SHA256:
`2921dac98549779567347f34bfe9fdee70cfa5eec005ca928369292f73a96f3b`.
Reproduce by lexically sorting all htmlq `src/*.ts`, its manifest, the public
htmlq wrapper, safe-bash manifest, `htmlq-boundaries.test.ts`, bundle/packer
scripts and both installed htmlq fixtures; hash relative path, NUL, file bytes,
NUL for each. This receipt identifies the working tree, not a committed delivery.
Documentation is outside that source receipt. No product repair was needed:
the new independent tests already passed, so no unvalidated production change
was made.

Host: Darwin 24.6.0 arm64; Node v22.22.2. Absolute-path Rust tools were found
after PATH discovery failed: cargo 1.98.1 (`797e8a9bc`), rustc 1.98.1
(`48a229cea`). Native htmlq reports package 0.5.0 and was compiled from the
exact pinned source using `cargo build --locked --release`. Dependencies:
kuchikiki 0.8.2, html5ever 0.26.0, selectors 0.22.0, cssparser 0.27.2,
url 2.5.8, clap 4.6.1. All four downloaded crate archive SHA256 values match
the supplied research pin. These are development-only inputs, never product
imports. Locked Cargo.lock SHA256:
`765b2bad3f0eb55325e77dd26c54de4490002794bd48ad0e7807c4eca747841f`.
Native executable SHA256:
`1effee4b6ea83d6553ecec7aab5236ef182972e46b700fd7a2290e7459ceae07`.

### Semantic observations

All A01–A40 saved fixtures in `src/compatibility.test.ts` were freshly replayed
against native literal argv/stdin, with complete stdout byte comparison, status
0 and empty stderr. There were zero differences. This fresh replay closes those
exact fixtures' previously missing native cells, including lazy removal,
template omission, raw script/style, duplicate matches, projection precedence,
base detection, malformed removal and selector state predicates. It does not
reconstruct or claim all 107 historical research controls.

All Q01–Q18 independently saved fixtures matched native and candidate bytes.
Each CLI result had status 0 and empty stderr; source bytes were unchanged and
no VFS files were created. Engine controls tested three deterministic chunkings
per fixture. Byte lengths below include result LFs; literal expected bytes and
argv remain in `src/independent-fixtures.ts`, rather than regenerating
expectations from product output.

| Fixture | Stdout bytes | Difference |
| --- | ---: | --- |
| Q01 nested selected nodes | 6 | None |
| Q02 selector list, missing attributes, empty output | 0 | None |
| Q03 duplicate selectors, Unicode | 11 | None |
| Q04 quoted attributes with embedded angle/quote | 16 | None |
| Q05 semicolonless text entities | 9 | None |
| Q06 semicolonless attribute entities | 14 | None |
| Q07 incomplete list markup | 22 | None |
| Q08 raw text versus RCDATA | 13 | None |
| Q09 separate template and foreign content | 6 | None |
| Q10 two attributes, one missing | 2 | None |
| Q11 empty attribute | 1 | None |
| Q12 whitespace-only text | 1 | None |
| Q13 mixed Unicode/text whitespace | 9 | None |
| Q14 root/path/query/fragment/scheme/four-slash URLs | 125 | None |
| Q15 detected versus explicit base | 20 | None |
| Q16 untouched descendant href/img src | 47 | None |
| Q17 pretty mixed inline/block text | 47 | None |
| Q18 two removable descendants | 26 | None |

Eight native negative selectors (`[`, `p >`, nested `:not`, `:is`, `:where`,
`:has`, `:lang`, `registered|p`) returned status 101, zero stdout and panic
stderr. Candidate engine returned structured `E_SELECTOR` for every case;
the inspected CLI screenshot shows `htmlq: E_SELECTOR`, status 1. These
diagnostic/status differences are intentional exclusions from exact parity.

All eleven native BOM controls were reconstructed as exact `A^N + EF BB BF + B`
stdin with `-t`. Status 0/empty stderr in every case. At N=0 output is `B\n`;
N=1,2,4092,4093,4097 retains the interior BOM; N=4094,4095,4096,8191,8192
drops it, reproducing the pinned segmentation defect. The existing candidate
BOM boundary regressions pass and retain every interior BOM. The exact
reconstruction and expectations are also documented in the acceptance matrix.
This is a deliberate exclusion, not a product regression to repair.

Memory-VFS extraction pipeline controls passed: text `B,A,B` through sort/uniq
produced `A\nB\n`, status 0/empty stderr; href extraction through
`jq -R -s 'split("\\n") | map(select(length > 0))'` produced the JSON values
`["/b", "/a"]`, status 0/empty stderr, with no VFS changes. JSON structure is
compared here; jq formatting is outside htmlq parity. Existing typed SDK/CLI,
same-file atomic output, symlink denial, output quota rollback, concurrent
destination change, inert scripts/URLs, denied host paths and network access,
pending parsing cancellation and exactly-once cleanup controls all passed.

### Verification and failures

- htmlq maintained workspace unit route: **150 passed**, zero failures,
  cancellations or skips; includes 19 new engine controls. Unit tests neither
  spawn native processes nor fetch/write fixtures.
- htmlq maintained lint, source and test TypeScript routes: passed. Focused
  Shell boundary route: **9 passed**, zero failures/skips; includes two new
  fixture/pipeline controls. ESLint for that boundary file passed.
- Maintained explicitly selected safe-bash workspace build closure: passed,
  including guarded compilation and native npm postbuild. Shared cache profile;
  not an uncached repository build.
- Browser-target engine bundle in a Node VM supplied only encoding and abort
  capabilities: bytewise inert script/style/template projection passed, with no
  process, require or fetch supplied. This is realm/graph evidence, not actual
  browser-engine qualification.
- Maintained public artifact packer, public-only npm packs and offline install
  outside the checkout: passed. Installed htmlq runtime and strict NodeNext
  declarations passed. `npm ls --all` passed with no private command/contracts
  installation. Canonical command identity, opt-in registration, CLI/SDK, live
  mutation and atomic VFS controls passed in that installed artifact.
- Corrected screenshot inspected: sorted A/B lines with status 0, followed by
  structured selector error with status 1; no clipped or corrupted output.

**Failed gate:** `npm run typecheck --workspace=@poe-platform/safe-bash`
returned 2 before compiling consumers. `qualified-current-release/peer.mjs:245`
requires root `exports["./safe-fs"].import` to equal
`./packages/safe-js/dist/safe-fs.js`; current root manifest yields undefined.
This was concretely traced to the shared checkout-peer admission contract,
independent of htmlq runtime. No unrelated root manifest, frozen/current peer
contract or assertion was changed to bypass it. Installed htmlq declaration
success is a separate cell and does not convert this failed gate into a pass.

Resolved QA execution failures: `/out` is read-only; ignored local task evidence
was used. Offline native build initially lacked cached html5ever; a locked
development-only download/build succeeded. First pack invocation omitted the
required `--out-dir`; corrected invocation succeeded. First screenshot omitted
`agentCommands()` registration and showed sort/uniq status 127; rerunning with
the same registration as the passing pipeline control fixed the QA setup.
No product repair, assertion relaxation or deadline increase was needed.

Public tarball SHA256, version `0.0.0-htmlq-qualification`:

- Safe Bash: `9a6c9c8ed36d76c4fa95e39ab1b42fcdb9228cbcbd5c474b6d6134bcdf060b1b`.
- SafeFS: `fcc71e245a64e99995b99c1d96f405c625444c2e810c8a70e2cba33305352e2c`.
- SafeJS: `982613c94db7cec9a404027dacde6a8936dbb39961728f5ca6957e300c942bf1`.

The private htmlq package has no external runtime dependencies; safe-bash only
composes/exports it and the packer bundles implementation/declarations. This
does not claim that the whole safe-bash artifact has no external dependencies;
its installed dependency inventory includes existing unrelated dependencies.

### Exclusions and missing cells

Awaited output failures/cleanup and structured errors intentionally differ from
native ignored `.ok()` output errors/panics. Same-file `-o` uses protected VFS
publication after reading input, rather than native early truncation. Shell
`>` redirection remains a separate shell behavior. Initial-only BOM stripping
intentionally corrects the pinned defect. HTML/JavaScript URLs remain inert
data, without sanitization or resource fetching.

Actual browser/workerd/Bun engines, other Node releases, other upstream revisions,
full HTML5 recovery/legacy selector/Clap/URL/pretty grammar and direct PI writer
parity remain unverified. `htmlqBaseline.fullHtml5Parity` stays false. Original
serialization controls passed in package tests; no persisted checkpoint/replay
contract changed, and separate checkpoint/replay runtime cells were not run.
No generated fuzz findings/seeds or minimized failures arose from these saved
deterministic fixtures. No performance measurements were run or inferred from
unit timings. Repository-wide lint/unit/build and registry publication were not
run or counted as passes for this tests-only increment. Full task qualification
remains incomplete for the failed shared typecheck and missing runtime cells.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No private package was published. Task-owned native source/build results,
logs, staged public packages, tarballs, screenshot and external consumer were
purged after recording these durable receipts.
