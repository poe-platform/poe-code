# Unchanged seven after the three-gap checkpoint

## Readiness and unchanged evidence

READY was already available at first inspection on August27,2026. Before any
product import, `gaps-ready-seal.json` records its exact text/hash, the explicitly
relinquished source lease, ancestor checks, and committed/current SHA-256 equality
for **all10 src/shell files**, not just the listed changed files:

- `d904cf86ec7ebcb2fb4113e5e31db1c976023716`: headerless executable fallback.
- `e64ce50e1e45c6cf5e3e3686ce7424cbf0fa50df`: env bash/sh shebang bindings.
- `0f5dbb3b5c65f773eada40876fa18098c36a5fbd`: scalar parameter work and seal.

Runtime SHA-256:
`fc8b4fc043068c2b8ad5efbb0a7100720424e307f54c8574bdf901a99aecd29f`.
Parser SHA-256:
`28492059750ba7f11fad563dfc03dba049f232b3f2212186cf3553e4559ae905`.
There is no separate new shell expansion/helper file in the sealed10-file tree;
the complete file inventory, including pattern and arithmetic helpers, is
verified against the final commit. Actual parser/runtime imports match the seal.
Author outcomes in the handoff are context only, not this replay's oracle.

**All11 original5cfb70a files and all5 b439dd9 postfix files are unchanged.**
Each is checked against its own introducing commit before and after capture.
The runner, corpus, frozen harness copies, old reports, and expectations were not
edited. A pre-import ad-hoc integrity lookup initially used5cfb70a for a file
introduced by b439dd9; `gaps-preflight-error.json` retains the exact failure and
correction. No product import/capture happened in that failed preflight, and no
product rerun or runner/oracle modification followed it.

## Actual results

One product replay and one complete native replay per profile ran at
**2026-08-27T03:20:26.547Z–03:20:30.728Z**, after the03:20:26.348Z seal.
Start/end HEAD: `0d625f3348b883593e89b1c7eec70b7df9324f12`.
Artifact: `replay-gaps-20260827t032026z.json`.

| Exact comparison | Original5cfb70a | Postfix b439dd9 | This replay |
| --- | --- | --- | --- |
| Virtual vs frozen expected observations | 0/7 | 3/7 | **6/7** |
| GNU5.3 vs frozen expectations | 7/7 | 7/7 | **7/7 fresh** |
| Historical Bash3.2 vs frozen expectations | 7/7 | 7/7 | **7/7 fresh** |
| Virtual vs GNU5.3 | 0/7 | 3/7 | **6/7** |
| Virtual vs historical Bash3.2 | 0/7 | 3/7 | **6/7** |

| Exact recipe | Current stdout | stderr / status | Result |
| --- | --- | --- | --- |
| kernel/type/type | `command\ncommand\nfunction\n` | empty /0 | FAIL |
| kernel/executable-file/executable-file | `ran:argument` | empty /0 | PASS, newly |
| kernel/env-shebang/env-shebang | `env:argument` | empty /0 | PASS, newly |
| kernel/source/source | `sourced` | empty /0 | PASS, retained |
| kernel/dot/dot | `dotted` | empty /0 | PASS, retained |
| kernel/eval/eval | `hello world` | empty /0 | PASS, retained |
| kernel/parameter/parameter | `abc:abc:XbcXbc` | empty /0 | PASS, newly |

All seven namespace/file-tree effects match unchanged expectations. Every current,
expected, original, and postfix stdout/stderr/status/tree tuple is retained in
`gaps-validation.json`; replay JSON retains full raw native bytes, launch details,
dispatch events, and executable identities. No skipped/xfail/waived cases.
The expected strict runner exit remains **1**, because type is still an exact loss.

The remaining type tuple expects `builtin\nfile\nfunction\n`, empty stderr,
status0, and an empty file tree. The virtual output honestly reports registered
printf/cat implementations as commands. This is a **virtual implementation-role
fairness difference**, not automatically a parser/dispatch bug. No native-builtin
label was fabricated to change the score; its exact failure stays in /7.

## Fresh native profile proof

Both complete seven-case cohorts were actually executed once, not loaded from
historical snapshots. The unchanged fixture remains exactly
`#!/usr/bin/env bash\nprintf 'env:%s' "$1"\n` with mode0755 and the original
argv. The original native harness role-bin setup is retained for every recipe;
there is no per-case interpreter override or alternate oracle.

The actual absolute `/usr/bin/env` binary, PATH links, Bash binaries, and all
frozen native tool identities are recorded. Fresh launcher controls exercise
`/usr/bin/env bash` through each profile's isolated PATH and verify the returned
version. Thus the primary child actually resolves to5.3.0, and the historical
child actually resolves to3.2.57; neither is silently relabeled or forced by
editing the native fixture. No sh recipe is added to this seven-case cohort.

- GNU Bash5.3.0 SHA-256:
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical `/bin/bash`3.2.57 SHA-256:
  `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.

Launcher/byte/PATH/version controls pass2/2, separately counted. These seven show
no additional3.2 mismatch; different native-family losses outside these exact
recipes remain outside this evidence. Frozen temporary-path rendering is
unchanged; raw stdout/stderr already equals compared stdout/stderr for all14
native observations, so rendering changes none of these results.

## Guards and limits

Integrity tests ran once:3/3. Scoped test typecheck ran once:exit0. Full commands
and output are in `gaps-ready-seal.json`; no global typecheck/build ran, and no
WebDAV type errors or other owners' source were modified.

All161 source files enumerated at this capture match before/after hashes. Each
of130 actually imported source modules matches its individual before/load/after
hash;132 total file imports are audited. No in-run source/import mismatch and no
retry for a greener snapshot. All10 READY shell-file hashes match both endpoints.

**Foreign endpoint drift is separate:** the later audit observes two additional
unimported files, `src/fs/s3/http/index.ts` and `src/fs/s3/http/request.ts`, absent
from the capture snapshots. Their hashes and non-import status are recorded in
`gaps-validation.json`. Foreign HTTP work was already visible as an untracked
directory at capture start. This does not invalidate the stable loaded shell
inputs, but forbids presenting this as a clean aggregate/product-wide snapshot.
Frozen-to-current non-shell dependency changes are also retained in replay JSON.

All owned native/virtual child groups are absent, zero children remain, and the
temporary fixture tree is removed. No SIGSTOP or waiting on unrelated work.
No source/API/dependency/benchmark/old-artifact changes; foreign staging untouched.

The other verifier owns nearby36+10 cases and legacy headerless-policy72 review;
this leaf neither reruns nor changes them. Plato's environment/accounting review,
old9 diagnostics, custom5 lifecycle cases, BOM/jq, and native-family limitations
remain separate and unrerun here. No output-policy/lifecycle API changes.
This closes **three more exact recipes only**: no full224/baseline run, universal
parameter/interpreter support, overall kernel parity, full Bash, or superiority
claim. The original0/7 and subsequent3/7 remain historical facts.

Reuse the unchanged command from repository root with a new artifact name:

```sh
node tests/shell-stress/expanded-kernel/replay.mjs --record next-replay.json
```
