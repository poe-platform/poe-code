# Hidden env split holdout: byte-API setup correction v2

August 27, 2026. **Pre-patch preparation / red baseline, not implementation
acceptance.** This additive profile repairs the verifier's six fixture writes;
it does not repair source, modify native expectations, or reinterpret failures.
Hidden programs and expected tuples remain confidential until the author's
candidate freeze. No author proposal, new fixtures, or patch was inspected.

## Immutable history and exact correction

All20 original files at `199038f4c96084f87e161bdbd72dc50a48b45a29` and all six
initial-baseline files at `7839db5370fe09d57f7aaaea29b5b2acb874cd36` remain byte
identical. The initial55-run result stays **1/48 exact,41 mismatched,6 setup
unavailable;0/7 hosts**. Its unavailable shebang observations were a helper
contract misuse, not evidence of unsupported product behavior.

`product-row-bytes-v2.mjs` is an exact copy of the frozen `product-row.mjs` with
only this line changed:

```diff
-      await fs.writeFile(row.fixture.path, row.fixture.virtualSource, { mode: row.fixture.mode });
+      await fs.writeFile(row.fixture.path, new TextEncoder().encode(row.fixture.virtualSource), { mode: row.fixture.mode });
```

The committed `src/fs/memory/index.ts:242` requires `Uint8Array` and rejects
strings. Encoding the intended UTF-8 script text satisfies that existing byte
API. All six encoded byte sequences are recorded and checked against the
unchanged fixture text; paths, modes, argv, environment, cwd, stdin, expectations
and effect assertions are unchanged. No decoding/output normalization is added.

`probe-bytes-v2.mjs` changes only the row-helper import. It still imports the
original seven-host module, whose existing helper import remains unchanged.
Inspection found **no `writeFile` call in that host module**; its output chunks
already use `Buffer`. No analogous host fixture misuse was found or corrected.

`corrected-baseline.mjs` versions the prior guarded parent: separate output and
temporary paths, new helper/probe copies and routing, exact correction proof,
and before/after guards for all26 historical files and the three new drivers.
The frozen request ordering,55 executions, public API, budgets, comparison
logic and original native selection are unchanged. There are no new cases.

## One complete corrected run

Actual run: `2026-08-27T10:26:03.875Z`–`2026-08-27T10:26:19.308Z`.

| Group | Slots | Exact primary tuple | Strict mismatch | Setup unavailable |
| --- | ---: | ---: | ---: | ---: |
| Command argv | 42 | 1 | 41 | 0 |
| Single-optional shebang | 6 | 1 | 5 | 0 |
| **Whole frozen row cohort** | **48** | **2** | **46** | **0** |

The same seven hosts run once: **0/7 pass,7/7 fail**. Total55 process executions,
not55 successful tests. All48 row runs produce actual product status, stdout,
stderr and relative effects with modes. Seven missing structured host results
are retained as failures, not removed denominator or supported-characterization
passes. All55 children finish naturally; no timeout, signal, output overflow or
surviving process group is recorded.

Product row statuses: two0,forty2,five126,one127. All42 command tuples exactly
match their prior product observations. The six newly observable shebang rows
produce one0 and five126. Their raw tuples are retained, not coerced to a
different status. No missing setup observation is disguised as a native loss.

Independent field matches over48 rows: status3/48,stdout15/48,stderr2/48,
full effects44/48. Exact tuple success requires all four fields simultaneously.
Effects include file bytes and modes without waivers. These are field counts,
not additional cases or a claim of mode-only failures.

Baseline split-option rejection still prevents the seven hosts from completing
their intended deep-contract checks. In particular, diagnostic output can
consume the small output budget before the intended sink behavior. Cancellation,
shared budgets, stdin origin, environment replacement and sink guarantees are
**not accepted or disproved as independent regressions by these early reds**.
The original host assertions are intact for later implementation acceptance.

## Source, imports and tool identities

Full source pin: `e7f4f2e3753184415f8098445c2009cb4cd9a6e9`.

```text
src/commands/execution.ts
1d084ab203dc59a510e39e5c71743b755ba9bdb5d4b018658398ed96c3dff700
src/shell/runtime.ts
2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b
src/contracts/command.ts
9c2f8ecf50def7250b01152a31a45c449109c3ae4d30878252cffe985c6e9df8
```

The isolated archive contains all212 source files and four unchanged package /
TypeScript manifests, each verified against its Git blob. No live source file,
dist shortcut, internal-only API or private dependency is overlaid. The archive
receives20 frozen inputs, two versioned helper/probe files and the hash-proven
existing import loader from `303d18449c6e01bae4f33dada2f2022f95a56d49`.

All55 per-run source/import guards pass: **10,615 actual module loads and55
natural broad `src/index.ts` loads**, with before/load/after hashes. All318
installed development-tool file/symlink identities are stable at endpoints.
The `node_modules` symlink target, source inventory, Git blobs, tool hashes,
actual import URLs and exact child argv/environment are retained in the raw
artifact. Node is22.22.2, SHA-256
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.

Live endpoint HEAD is `9b65787d4d6805aa182ff138996bf4ab7bacd764` at both captures.
Selected live source/manifest hashes are individually stable, and the index is
empty at those endpoints. Foreign workspace changes exist and remain untouched;
this is **not a clean-live-aggregate claim**. Only the complete committed archive
is the product under test. No production, contract, private-package or manifest
file is modified by this work.

## Native references: reused, not freshly captured

Both frozen whole profiles remain unchanged, and all four executable hashes
match at both current endpoints. This run compares all48 rows to the same GNU
primary profile; Apple historical tuples and actual-kernel controls remain
retained, not rebound to different cwd/environment or chosen per case.

```text
GNU env9.7 on Darwin
1026eb36ffd2fdca6d064c0ffd6dd99ceb7bb3f49ec5e804df2c53bef372dbf0
GNU Bash5.3
8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c
Apple /usr/bin/env
9eb7c5aed7f3c7fe07b77d9a84d0a7c6a8c68c17a15aa3dace0d8ff02d352776
Apple /bin/bash3.2
35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3
native-aligned.json
bca8b30a21de8f09e5e660d3f77480cdf8ac3b4a00c36490987b6d15ef9cf818
```

Exact paths and version captures remain in original evidence; versions are
reused with binary identity proof, not newly invoked or described as latest.
**Zero fresh native executions**. The GNU capture is Darwin, not a universal
GNU/Linux environment-order claim. The non-S single-optional-argument policy
and actual Darwin kernel splitting remain distinct; the original raw native
loss is not forced green. No protocol decision or oracle is changed here.

## Checks, replay and cleanup

New integrity checks: **7/7 pass**, no skips, covering history, exact helper diff,
script bytes, complete execution, strict native tuples, imports and cleanup.
Three new executable drivers pass `node --check`. No global TypeScript, build,
benchmark, legacy, accepted accounting, first-read, kernel or other owner's
suite is rerun. No dependencies are installed.

```sh
node --test tests/shell-stress/env-split-holdout/corrected-integrity.test.mjs
node tests/shell-stress/env-split-holdout/corrected-baseline.mjs
```

The second command is a one-shot capture and refuses an existing evidence file.
Reproduction needs a disposable checkout with only the two new generated
baseline output files absent; preserve the committed evidence elsewhere. It
reconstructs the same full source archive and requires the recorded native
binaries and installed development tools. Future acceptance must use a new
additive artifact/profile rather than overwrite this pre-patch run.

`baseline-e7f4f2e-bytes-v2-cleanup.json` binds the raw artifact hash and proves
removal of this run's owned temporary archive and absence of all55 child groups.
No foreign process was signalled or temporary artifact removed. No source fix,
feature-family closure, native parity, full gate or superiority is claimed.
