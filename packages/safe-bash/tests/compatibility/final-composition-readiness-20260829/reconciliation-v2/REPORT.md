# Reconciliation complete; procedure ready, final freeze still gated

August 29, 2026. This grant began 16:49:51 UTC and expires 16:57:51 UTC including
publication. The 72-hour campaign endpoint remains **18:02:36 UTC today**.
No compiler, package producer, product, Worker or native oracle was executed.

## Tree discrepancy resolved precisely

Both previous identities are correct for different pathname domains:

- `3adc676a0ab638c9788ef007e465931d65d2c6fe` is the original broader repository
  tree. Its authenticated root retains `.gitignore`, `AGENTS.md`, `benchmarks`,
  `docs`, `package-lock.json`, `scripts`, and `tests` in addition to the selected
  build-root entries. None of those seven additional root entries is a shipping
  input in the 309-file manifest.
- `c5e49e70c295d7e354eba53d1a91141ad701e3f6` is the projection rebuilt from only
  those 309 selected build inputs. Comparing that projection to the broader root
  caused the c314 reviewer refusal. This was not corrupt source, conflicting
  blob hashes or a different sort order.

The helper authenticated the original witness blob by its expected Git blob ID,
size and SHA256; decoded the uncompressed tree-witness DATA; verified every tree
SHA1 and Git entry order; followed all 309 selected paths through the original
tree witnesses; and verified each selected blob's SHA1, SHA256 and byte length.
`TREE-RECONCILIATION.json` contains the exact root entries and bindings.

Encoding is explicit: each tree entry is ASCII octal mode, ASCII space, exact
UTF-8 basename, NUL, then the raw 20-byte object ID. Directory mode is `40000`;
file modes are individually bound. Sort by unsigned basename bytes, treating
directory names as ending with `/`. Hash `tree <decimal-body-byte-count>\0`
followed by the entry bytes using SHA1. The input manifest instead uses complete
repository-relative UTF-8 pathname byte ordering, with its exact row array
canonicalized by JSON.stringify and hashed using SHA256. These domains are never
interchanged. No stored Git-object existence is required for a derived projection.

This new erratum closes the earlier identity qualification; the original failed
helper stderr, old report, all failed runs and their resource qualifications
remain unchanged. This grant used **one DATA helper invocation**.

## Explicit current candidate and README decision

`CANDIDATE-INPUTS.json` binds **323 inputs**, their paths, exact modes/sizes/blob
identities/SHA256 and accepted origins. ROOT's accepted PUBLIC309 README is
selected by blob `d4618a2170f53ed8f6f20fe1a320ab32e84dab23`, SHA256
`f035946288322e23951aba9f92e278fb13dac3c3a2bb21271a516cd6f2329621`.
The current README remains untouched and unreviewed. Every other selected working
file matched this pre-local-fix candidate at the helper's finite snapshot.

- Candidate input projection: `696cf47f57657f2b6004f49031e6b5290d0f96ee`.
- Exact candidate-file SHA256:
  `ef910f1c3bccf4f0345a7d938cf9f2969a8d0e03ceaaafa55bf93b837e40cdbd`.
- Canonical candidate rows SHA256:
  `9766e17a92f713fd63d95615a20ffcc57283ac9f2b9c3975574e06179efc423c`.

The 40 extra tracked paths remain inventoried and excluded only from the derived
build, not deleted from the working tree. No live HEAD or whole-file historical
overlay is authorized. The candidate is bound DATA, **not a final build freeze**.

## Latest PIPESTATUS gate — ROOT update

ROOT supplied diagnosis **0989ed9b**: **75 PASS / 3 FAIL**, all failures are R17
across the three layouts because the existing local builtin lacks `local -a`.
The scalar PIPESTATUS publisher is correct and must be preserved. ROOT explicitly
chooses narrow product support for **`local -a NAME`**, not a fixture workaround.
No other local flags, declare/typeset, associative arrays or public API expansion.

Plato's source/PURE fix and its review are pending. `ROOT-UPDATE.json` records this
new authority without rewriting the earlier cause-pending receipt. The effective
remaining gates are:

1. Receive the exact accepted runtime/local-helper delta after review.
2. Incorporate only that delta into the present union, preserving the already
   compared public Node, CORE, arithmetic and PIPESTATUS changes. Recompute all
   paths/counts/origins/hashes; a newly added helper can change the 323 count.
3. Receive **fresh ROOT producer GO** before final input freeze, compiler or pack.

There is no additional author-build authority in this reconciliation grant.

## Exact prepared build/package procedure

`TYPE-AND-TOOL-BINDINGS.json` binds the existing Node/TypeScript/npm tool sources,
distinct empty npm configs and **115 type-tool files / 2,522,132 bytes**. Existing
LOCAL @types/node 22.20.1 and declared undici-types 6.21.0 were reauthenticated at
both their pinned original locations and isolated copies. No dependency was added
or installed. Remaining executable-tool pins are the existing qualified producer
pins and must be checked contemporaneously at launch, not treated as newly run.

`PROCEDURE.json` contains exact absolute executable paths, arguments, cwd, a
whitelisted environment and prospective output root
`/private/tmp/safe-bash-final-composition-20260829`. It specifies:

- Materialize only the final re-admitted input manifest into a fresh clean source
  directory. Preserve its strict config and use the populated pinned typeRoots.
- **One** direct pinned TypeScript compiler invocation, required exit 0. No reuse
  of 58ba544's failed emits, previous dist, repository HEAD or excluded extras.
- Enumerate every actual JS/map/declaration/declaration-map output and its source
  cause. Recompute full shipping/private closure; do not inherit 1002/1014 counts.
- **One** trusted pinned development npm `pack --offline --ignore-scripts --json`
  with the exact separate user/global configs, fresh cache, disabled audit/fund,
  and explicit owned destination. No install or lifecycle execution.
- Commit exact archive and producer receipt size/hash **before** any decode;
  admit the regular bounded file and decode that same authenticated Buffer.

The prepared commands remain valid templates; the selected final input binding
must be refreshed after the accepted local-array fix. Nothing here executes them.

## Minimal existing public-API smoke, not a new campaign

`SMOKE-PROPOSAL.json` binds the existing workflow source
`tests/integration/agent-bash-coherent-author-20260829/v2/workflows.mjs` and selects
only **six existing cases**, prospectively **18 observations across three layouts**:

| Existing ID | Finite coverage |
| --- | --- |
| C01 | Public root/Node export equality; explicit opt-in; default80 inventory; inert provider |
| C02 | Strict quoting/conditional and printf-to-cat pipeline |
| C07 | MemoryFileSystem stdout/stderr redirection effects |
| C12 | Mock curl redirect authorization/header stripping, VFS output and disposal |
| C13 | Git status/rev-parse/ls-files through ReadOnlyFileSystem; unchanged Git data |
| C14 | apply_patch stdin, MemoryFileSystem effects and Git diff |

No new case, assertion, engine, Worker, live network or native oracle is proposed.
Reuse existing case bodies and fixtures, with their bindings updated to the final
candidate; do not run an old dispatcher asserting hardcoded 3adc/1014 identity
against a new package. This smoke checks selected public commands and memory/
readonly FS interactions, **not all 80 command behaviors or Real/S3/WebDAV
backends**, full Node execution, PIPESTATUS78 remediation or CORE210 coverage.
Those prior failures and acceptance boundaries remain separate.

## Receipt and bounds

`RECEIPT.json` SHA256:
`7bfbcf0a0e24dd8f8fa285803512eb8d9fa8d1c843aaaea53c7cd1d4d0392161`.
The helper snapshot retains 3,706,123 logical bytes and 3,447,197 capture bytes;
adding the explicit 16,777,216-byte publication reserve gives 20,483,339 logical
bytes and 20,224,413 capture bytes, within 128 MiB work and 24 MiB capture.
Known roles including planned publication: **20/24**, conservative peak **3/3**.
One helper and one serial Git child; child completion and direct tool completion
are recorded, not fabricated transitive PID closure. Git physical allocation,
allocated blocks and RSS are excluded. All publication is scoped and atomic;
foreign working source/staging and previous failures remain intact.

**Ready: reconciled input domain, accepted README selection, exact tool/command
procedure and narrow existing smoke proposal. Waiting: accepted local-array
source delta and fresh ROOT producer GO. No final freeze or execution.**
