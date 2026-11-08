# Independent jq literal-file evidence

**PASS: 2 cases × 2 repeats = 4/4 exact native captures.** Separately,
version/build metadata passed 2/2 (six native invocations total).
Captured August 27, 2026, 02:19:20 UTC. This closes only the missing literal
regular-file reruns, not the broader proposal/source review.

| Frozen case | Exact argv | Status | stdout hex | stderr hex |
| --- | --- | --- | --- | --- |
| `file-unicode:-Rc` | `["-Rc",".","unicode-start","-"]` | 0 | `22efbfbdefbfbdefbfbd220a` | empty |
| `file-unicode:-Rsc` | `["-Rsc",".","unicode-start","-"]` | 0 | `22efbfbdefbfbdefbfbd5c6e220a` | empty |

Each capture creates an actual `unicode-start` regular file with bytes `f09f`
and supplies stdin `98800a`. Expectations come exclusively from the immutable
author `planned-test-only-changes-v2.json` rows, cross-checked against original
`legacy-native-proof.json` literal-file tuples and `raw-input-native.json`.
Historical strict-policy overrides are not the native expectations.

Native: `/usr/bin/jq`, `jq-1.7.1-apple`, `--with-oniguruma=builtin`, SHA-256
`1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`.
Exact frozen legacy-proof environment: `LC_ALL=C`, `LANG=C`, `TZ=UTC`,
`NO_COLOR=1`, `PATH=/usr/bin:/bin`; no inherited variables. The initial
`capture-raw-input.mjs` inherited an unrecorded environment; reproducing that
unrecorded environment is not claimed.

`native.mjs` uses Node builtins only, no shell, product imports, network or fd
substitution; each invocation has a fresh isolated temporary cwd, a 2-second
SIGKILL watchdog and 64 KiB capture bound. Before/after checks assert `lstat`
regular-file/non-symlink status, unchanged namespace, identity and exact bytes.
All six temporary directories were removed in `finally`, with `ENOENT`
confirmed; all native children were synchronously reaped. Failure paths also
run the same cleanup. No running processes or temporary fixtures remain.

`native-review.json` records every argv, stdin, full output hex, source hash,
native configuration, environment, before/after observation and cleanup.
Evidence SHA-256: `08b138d97e839a678e6c4120ef14f16dabb24ea82cf30ea02abc4e19d5ed44b6`.
Harness SHA-256: `b140a684d74ca6782f704d8bce4a01225f244e803f229b0ef6e3811553a5fde6`.

Reproduce from the repository root (JSON goes to stdout; no evidence overwrite):

```sh
node tests/commands/structured-stress/jq-grammar-literal-file-review/native.mjs
```

All checked-in files were authored through `apply_patch`; only generated
temporary fixtures use runtime `writeFile`. The prior FD-limited report remains
byte-identical (pinned before/after); no canonical, production or old evidence
was edited. No corpus expansion, delegation, chunk/VFS/pipeline/full-product
acceptance or superiority claim. Endpoint checks do not exclude transient
mutation or ABA. Other reviews retain their own independent scope and verdicts.
