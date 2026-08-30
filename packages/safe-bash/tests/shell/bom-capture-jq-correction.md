# Authorized native-backed BOM/jq test correction

**August 27, 2026 — corrected cohort 64/64; historical 63/64 remains unchanged.**

## Authority and scope

The user/root decision in `/tmp/safe-bash-bom-jq-root-decision.txt` expands the
previous diagnostic-only lease to exact status, stdout, stderr and byte/sink
assertions for the **three existing inputs in one jq plugin control**. Its
text and hash are preserved in `bom-capture-jq-correction.json`.

Only that final control in `bom-capture.test.ts` changes. The preceding 63 test
bodies are byte-for-byte identical, including the independent public
`JSON.parse` assertion rejecting a preserved leading U+FEFF. No production,
contracts, archive, manifest, dependency or public JSON parsing policy changes.

## Exact provenance and expectation change

Before editing, all three native controls were rerun with `/usr/bin/jq`, argv
`[-c, .]`, no shell, and the same explicit non-inherited environment as
`f752ad5`: `PATH=/usr/bin:/bin`, `LC_ALL=C`, `LANG=C`, `TZ=UTC`, `NO_COLOR=1`.
The executable SHA-256 remains
`1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`, pinning the
previously measured `jq-1.7.1-apple`, `--with-oniguruma=builtin` toolchain;
version/build commands were not unnecessarily repeated. Native calls had
five-second watchdogs and 256 KiB capture limits.

All three current product controls exactly matched those fresh native tuples
and the immutable `f752ad5` native tuples, including both external byte sinks:

| Existing input | stdin hex | Exact expectation for native/product |
| --- | --- | --- |
| Plain JSON string | `7b226f6b223a317d` | exit 0; stdout `7b226f6b223a317d0a`; stderr empty |
| BOM JSON string | `efbbbf7b226f6b223a317d` | exit 0; stdout `7b226f6b223a317d0a`; stderr empty |
| BOM JSON bytes | `efbbbf7b226f6b223a317d` | exit 0; stdout `7b226f6b223a317d0a`; stderr empty |

Old BOM expectations were exit **5**, empty stdout/zero stdout bytes, and
`jq: invalid JSON input at offset 0\n`. New exact expectations are exit **0**,
`{"ok":1}\n`, its exact hex above, and empty stderr/zero stderr bytes. All three
inputs now share these exact assertions, with copied external stdout/stderr
chunks checked against the returned byte fields. No input, control, status or
payload check is omitted, normalized, skipped, or loosened.

Cause: structured source `b9187c0` and Arch handoff `2dd9472` explicitly adopt
native leading-BOM acceptance. This later parser behavior is distinct from
capture fix `abdc741`, whose two decoders preserve BOM text in shell results.
The correction stands on the exact native proof and narrow user authorization;
it does **not** approve the entire jq grammar/source or the rejected canonical
proposal v2 reviewed at `f84b8e2`. Those Arch gates remain separate and pending.

## One post-correction run

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 --test-reporter=tap tests/shell/bom-capture.test.ts
```

Node v22.22.2; 20-second process limit; **64 tests, 64 pass, zero failures,
skips, todos or cancellations**. Independently counted within that run:

- All **16** formerly failing BOM-preservation tests pass.
- All **22/22** byte-field/external-sink cases pass unchanged.
- The corrected plugin control passes with all three native-backed inputs and
  both sink comparisons for each execution.
- The separate public `JSON.parse` rejection control passes unchanged.

No redundant prechange full64 run: the fresh `f752ad5` **63/64** evidence is
retained and the three current tuples were independently rechecked before the
edit. No retries or broader suites were run.

## Guards and preserved history

The post-correction **490-entry** source/dependency/immutable-file guard has
equal before/after hashes; raw TAP, complete manifests, selected source hashes,
old/new test text/diff and exact tuples are in the new JSON evidence. Its tested
runtime SHA-256 is
`1d303091932cfca31e1c1b0de7e35609173db7bcd71cc2fb14fd5740faeb9491`.
The source/dot/eval author remains active; endpoint equality cannot exclude
transient edits/reversions or establish whole-product acceptance. No worker
was stopped or asked to stop.

Original `d8d0f12` reports/raw initial runs, `781f272` historical diagnostic-only
63/64, and `f752ad5` later status-conflict 63/64 remain immutable. The original
test bytes are retained in Git and in the new correction evidence; only its
explicitly authorized live plugin control changes. No earlier red checkpoint
is relabeled green, and no tar byte failure is inferred.

No source, native-shell, broad-jq, full-suite, lifecycle, invocation or tar
execution; no build, dependency installation, delegation or watchers. All
owned children completed.
