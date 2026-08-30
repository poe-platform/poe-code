# Independent scalar substring holdout — prepared, not accepted

Prepared August27,2026. This leaf owns only this new directory. No new author
substring expectations or source were inspected before freezing the cases and
native artifact; no product code was imported or executed. Root resumes this
leaf after an explicit author READY. **This preparation stops without polling.**

## Frozen coverage

`cases.mjs` defines24 independent scalar recipes, not the other worker's original
36+72 reconciliation or an attempted93-row duplication. They cover offsets and
lengths; omitted/empty/zero length; positive/negative/beyond-end indices; negative
length endpoints; arithmetic names, increments and short-circuit side effects;
parenthesized/unparenthesized ternary delimiters; default `:-` ambiguity;
empty/unset values; nested default words and command substitutions; quoted and
unquoted fields, whitespace/nonwhitespace IFS, empty concatenation; scalar `$1`
and `$2`; runtime arithmetic errors versus a same-line malformed expansion;
UTF-8 multibyte and combining-codepoint boundaries. No arrays or `$@`/`$*`, new
syntax family, BOM/jq cases, output-accounting redesign, or lifecycle-policy
characterizations are added.

The GNU Bash Reference Manual's Shell Parameter Expansion section was consulted
for arithmetic offset/length and colon/default distinctions (official GNU page:
`https://www.gnu.org/software/bash/manual/html_node/Shell-Parameter-Expansion.html`).
**Actual native raw observations, not documentation examples or author values,
are the oracle.** No expected output was hand-copied from the implementation.

## Complete native capture

`native-frozen.json` captured at04:42:31.131–04:42:31.893 UTC, HEAD
`b4cde0bf2694c353222e21ebd8f49eeae329401e`, without importing product source.
All24 recipes run under each complete version/locale combination:

| Profile | Rows captured | Status0 | Native nonzero observations |
| --- | --- | --- | --- |
| GNU5.3 / C |24|20|4|
| GNU5.3 / en_US.UTF-8 |24|20|4|
| Bash3.2 / C |24|18|6|
| Bash3.2 / en_US.UTF-8 |24|18|6|

These are **96 native executions of24 unique recipes**, not96 unique tests or
96 product passes. Nonzero rows are retained expected native behavior, not
missing oracles, skips, or successful unsupported-product characterizations.
There are no product acceptance counts yet.

GNU Bash5.3.0 is the primary version in BOTH locales; historical Bash3.2.57 is
kept in BOTH. No per-case oracle selection occurs. `/usr/bin/locale -a` confirms
en_US.UTF-8; charmap and actual Bash length/slice controls verify the locale,
including raw invalid UTF-8 in C and NUL/FF capture. Four launcher/locale/byte
controls pass independently of recipe outcomes. All locale/version commands
and children are recorded, including binary hashes:

- GNU5.3: `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical3.2: `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.

The native versions differ on six exact tuples in each locale: negative length
endpoint, inverted negative length, nested default arithmetic words, division
error, malformed same-line expansion, and invalid octal. Some are diagnostic
differences; do not report six distinct product bugs. Exactly the three Unicode
recipes differ between C and UTF-8 in each version. Keep all profile differences
visible; a product's documented Unicode policy does not turn a C-native mismatch
into a passing characterization.

Every row retains exact script hash and source in argv, shell name, argv0, cwd,
stdin, scrubbed environment, status, raw base64 stdout/stderr, and relative file
effects with modes. Fixtures are isolated, seeded0644, and snapshots preserve
both before/after contents. Invalid expansion leaves phase=`seed`; the observed
runtime arithmetic failures leave phase=`before`. No diagnostic, path, encoding,
or status normalization is applied.

The read-only existing `../current-shell/support.mjs` supplies bounded children:
three-second deadline,1MiB combined output cap, process-group cleanup. Its hash
is pinned. PATH is `/nonexistent`; recipes use builtins only. Each case gets a
fresh owned temporary directory removed in finally. All96 case directories were
removed; all recorded children completed without timeout, overflow, signal or
live group. Native processes are test oracles, never product transports.

## Two host controls, intentionally unexecuted

`host.mjs` exports `observeHost(library, id)` for a future isolated READY-backed
worker supplied with the actual package exports. It does not import product
code itself. Frozen host definitions cover:

1. A substring result exceeding maxExpansionBytes with a larger independent
   output budget; require typed rejection before output or trailing mark calls.
2. Caller cancellation during a host offset command substitution; retain the
   caller reason, observe its late rejection, and prevent trailing output/effects.

These are two planned executable host controls, **not two passes**. They do not
rerun Plato's accepted accounting cohort or the custom head0/first-read cases.
They must run in separately bounded strict-unhandled-rejection children during
the resumed acceptance, with source/import guards and retained failure evidence.

## Integrity, reproduction, and next handoff

`freeze.json` pins case, capture-runner, host-control, integrity-test and native
artifact hashes. `integrity.test.mjs` verifies immutable inputs, all4×24 rows,
raw tuples, native error retention, actual locale controls and capture cleanup.
It executes **no product code and no fresh native cases**.

From repository root:

```sh
node --test tests/shell-stress/substring-holdout/integrity.test.mjs
node tests/shell-stress/substring-holdout/native.mjs native-new-date.json
```

The second command reruns all four whole profiles with a fresh immutable output
name; do not overwrite or silently replace `native-frozen.json`. Normally the
resumed product replay should reuse the frozen references after checking binary,
fixture and helper hashes. An acceptance driver/source audit will be added only
after ROOT resumes this leaf with READY; no acceptance command is claimed here.

No active author writer was stopped or waited on, no red product baseline was
run, and no source/contract/core/FS/benchmark or foreign tests/staging were edited.
Old9 profile diagnostics, five custom-first-read cases and truthful registry-role
differences remain separate. This is a bounded scalar preparation, not broad
substring-family acceptance, full Bash, product completion or superiority.
