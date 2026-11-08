# BOM capture — scoped author fix, 2026-08-27

Baseline HEAD: `8aaf610d26e8dc310bf6ac1f713cf2614cc1120e`.
Only the two final `Shell.exec` result decoders in `src/shell/shell.ts` change
to `new TextDecoder("utf-8", { ignoreBOM: true })`. This retains leading U+FEFF
in stdout/stderr text. Raw bytes, external sinks, byte limits, cancellation,
default replacement decoding and all JSON/shared helpers remain unchanged.
Public exports, API shape and dependencies do not change.

Official semantics checked against Node's TextDecoder documentation and WHATWG:
`https://nodejs.org/download/release/v22.17.0/docs/api/util.html#new-textdecoderencoding-options`
and `https://encoding.spec.whatwg.org/#interface-textdecoder`.
The option preserves the BOM; it does not enable fatal decoding. Actual runtime
is Node v22.22.2. This library's preservation policy is user-directed, not a
claim that WHATWG mandates a particular convenience-field policy.

| Check | Result |
| --- | --- |
| Unchanged independent64, before fix | 47 pass / 17 fail: 16 BOM text failures plus the separate jq mismatch |
| Unchanged independent64, after fix and guarded repeat | 63 pass / 1 fail; all 16 BOM failures resolved |
| Byte fields / external sinks | 22/22 pass; decoder, replacement, caps, cancellation and JSON.parse controls pass |
| Frozen invocation132 + author closure211 | 343/343 pass, no skips/xfails/TODOs |
| Global / build / benchmark noEmit | All exit 0 |

The remaining independent jq assertion expects
`jq: invalid JSON input at offset 0\n`, but observes
`jq: parse error: Invalid numeric literal at line 1, column 4\n`.
It is unchanged and still fails; neither JSON parsing nor its test is adjusted.
A small separate probe confirms plain JSON remains status 0 with exact output
`{"ok":1}\n`; both BOM-string and BOM-byte inputs remain status 5, empty stdout
and the observed diagnostic. This is not a tar byte failure.

The first post-fix validation guard detected concurrent changes to
`src/fs/memory/index.ts` and `src/fs/mount/COMPARISON.md`; those initial counts
are not claimed as fixed-dependency acceptance. The immediate bounded repeat
checks all 156 current src files plus eight immutable test/evidence/READY paths:
164 matching endpoint hashes, zero changes. Tests have 20/60-second parent bounds;
all children complete. No watchers, first-read/NUL/full-suite or native Bash
reruns. Endpoint equality cannot exclude transient writes/reverts.

`bom-capture-fix.json` records exact hashes, commands, results, the invalidated
guard and stable repeat. Shell SHA256 changes from
`f4be37e13e400fb1e0cf52e3ba9f16c4ef32c8ae1a2c3d09908369a680e4931e` to
`4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e`.
Runtime SHA256 remains `8af9bb685fee68e6f199e1ebf9613ac8da50572f357fd98599e570d30810e820`,
matched to committed source `3aa3a4110c09fbab48d9aa8a8d762f48c8ce56cc`.
Independent BOM tests/MD/evidence and the earlier invocation READY are unchanged.
This is an author fix checkpoint, not independent acceptance or full Bash.

```sh
node --unhandled-rejections=strict --import tsx --test --test-concurrency=1 --test-reporter=tap tests/shell/bom-capture.test.ts
node --unhandled-rejections=strict --import tsx --test tests/shell/{invocation-modes,invocation-closure-discovery,invocation-closure-read,invocation-closure-sh}.test.ts
./node_modules/.bin/tsc --noEmit
./node_modules/.bin/tsc -p tsconfig.build.json --noEmit
./node_modules/.bin/tsc -p benchmarks/tsconfig.json --noEmit
```

The new `/tmp/safe-bash-shell-bom-fix-ready.txt` identifies the atomic commit and
source freeze. Source/dot/eval and all earlier known open findings stay separate.
