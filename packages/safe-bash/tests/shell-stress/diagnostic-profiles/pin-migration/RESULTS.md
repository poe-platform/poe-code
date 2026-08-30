# Bounded two-pin migration: author result

**Frozen candidate:** `96146732cc7e17a67797389de5b83d14b29b41bf`.
Migration guard first froze at `e192662d2fda90104ab5a7e59c9b5c88bf5838c3`;
the second candidate corrects only new control matching/evidence routing.
Execution: **2026-08-27 12:09:29–12:10:18 UTC**, recorded in
`execution-v2/summary.json`. This is author verification, **not independent
acceptance**, a whole-project gate, superiority evidence, or full native parity.

## Exact two-binding delta

Historical seal commit `eb602376d11f9d19cd22864027fe51f564944381` and parent
`a95a10c970fe18f2039cbd90ca189bb53c560e26` have the complete old driver bytes;
`4fa20ac6cadb9d37fa9da4d205dc37a5a1bcb9f9` supplies the complete new bytes.
`authentication.json` and `driver-delta.diff` authenticate that full transition,
not merely hashes of the current files.

| Unedited sibling driver | Historical SHA256 | Fixed current SHA256 |
| --- | --- | --- |
| `tests/shell-stress/differential.test.ts` | `985d6e578841af649bbf4469fa69c48634070077baa9ecb85b60429da085e118` | `59027400ad1ea3741e652c49a50b03e076bb2672bc2c24cbee5c994caef1ec32` |
| `tests/shell-stress/current-gaps/compatibility.test.ts` | `93f4d8dd5938ddba1464b126e5aec00c5304eacbd7470768e550301837dc4fa6` | `ddf404839fae525ae5ebc6d4241c09be307b4ab9359c099d7f7dac67e2c975ca` |

Exactly these two current bindings differ; **12 other historical test/helper
pins remain enforced**. The native seal SHA256 remains
`0cb9d0b498331434ec2a49dd4f75b30dcfb10db2ff8fd029613d948f119d4cf3`.
The canonical before-hook selects the current binding; the historical guard
still requires the original two driver blobs. Neither identity nor any of the
88 behavior assertions changes. Original 89 hook failures remain in their
authenticated original capture and byte-preserving `original-89.tap` excerpt.

## Source/profile facts, separately

The prior sibling-driver commit changed reference imports/labels from live
`/bin/bash` with `argv0=shell-stress` to frozen GNU5.3-primary observations with
`argv0=shell`. It did not change their fixtures or body assertions. The diagnostic
suite does not execute those sibling drivers: it still replays each selected
live native profile against its own unchanged seal, then compares current virtual
results. The 88 new sibling reference tuples also match that seal's GNU5.3/shell
tuples; this crosswalk does not assert mode parity or arbitrary native equivalence.

Native profiles are GNU Bash **5.3.0/aarch64-apple-darwin25.4.0** at the sealed
`/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash` and historical
**3.2.57/arm64-apple-darwin25** at `/bin/bash`, with Darwin `/bin/cat` and
`/usr/bin/head`, C locale, UTC, PATH `/usr/bin:/bin`, and parent umask022.
Pinned executable hashes are respectively
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c` and
`35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.
The original identity/version/lifecycle assertion passes on both profiles.
This is not a GNU/Linux utility profile. No oracle is switched per case.

## Actual final counts

| Complete cohort | GNU5.3 pass/fail | Historical3.2 pass/fail |
| --- | --- | --- |
| 72 differential | 72 / 0 | 67 / 5 |
| 5 syntax | 5 / 0 | 0 / 5 |
| 11 gaps | 11 / 0 | 7 / 4 |
| 1 identity/lifecycle | 1 / 0 | 1 / 0 |
| **89 total** | **89 / 0, exit0** | **75 / 14, exit1** |

Both runs have **zero hook failures, skips, cancellations, and TODOs**. Historical
failures occur in current-product comparisons after successful live-native seal
checks; they are retained, not patched or reclassified as passes. Exact14 names,
diagnostics, status and byte/file differences are in
`execution-v2/historical-3.2.json` and `.stdout.tap`: five differential failures
cover nested syntax, fatal parameter/arithmetic/substitution expansion, and NUL
substitution; all five original syntax diagnostics fail; four gaps cover moved
input/output descriptors, prevalidation prior effects, and fatal-parameter prior
effects. No fixtures, expected observations, native diagnostics, or file effects
were rewritten to remove these failures.

Six binding controls pass, including both mutated regular-copy drivers rejected
before a case marker can be written, unchanged-fixture rejection, and both
historical/current distinctions. Each separate **full89 mutated-driver run fails
all89 at the before-hook**, including identity: zero bodies are admitted and no
native scratch effects occur. Those expected rejection runs exit1 and are not
counted as89 passing behaviors. Historical guard-only replay exits0 with complete
original driver bytes; its raw count fields use -1 for “not a test runner.”

## Candidate attribution and retained limits

`execution-v2/prerequisites.json` records **235 authenticated committed input
files**, every source SHA, Node22.22.2 executable SHA, tsx4.23.12/esbuild0.28.2
installed/copied file hashes, native utilities, actual commands and environments.
The helper-equivalent source/root/fixture aggregate is
`92b1d95473f813df0f0e827df70da8c8e5d350da08c5b27a337345ec2b3e193c`.
For example `src/shell/shell.ts` is
`538f7ea1504019fcde03abc2781c1f903573243a0332033b87501804a1c4ac5c`.
The two attempts execute identical source/root/test snapshot inputs. Foreign
dirty `package.json` and `tsconfig.json` are disclosed and excluded from the
committed regular-copy candidate, never edited or committed here. The isolated
copy has no Git metadata; outer candidate/hash evidence, not its empty helper
revision strings, establishes attribution. No build or full-source type gate ran.

The original attempt's three new-control matcher failures and incomplete steps
remain in `execution/` and `ATTEMPT-1.md`. They are not silently overwritten.
Final postflight confirms235 copied inputs, installed/copied tool files, native
binaries, and22 frozen author files unchanged. Both run trees were removed,
runner groups closed, native scratch directories cleared, and original bounded
child cleanup retained. No network dependencies, mock guests, native product
execution, live sibling mutations, or unrelated source/config edits occurred.
The ten cleanup archive pins and separate84 pre-env-S failures remain outside
this migration. A different ROOT-assigned reviewer must independently accept it.
