# Shell BOM capture: independent red checkpoint

## Status and ownership

This leaf review changes only `bom-capture.test.ts`, this document, and
`bom-capture-evidence.json`. No shell, shared contract, archive, structured
command, manifest, or existing test was edited. No agents were delegated.
The immediate handoff is `/tmp/safe-bash-shell-bom-review-findings.txt`.

The requested text-preservation behavior is **not implemented** here. Root must
route the proposed fix serially to the active invocation author, the sole
`src/shell/**` source writer, after that author's checkpoint. Shared byte helper
policy belongs to Curie; this finding does not require changing that policy.

The archive README was inspected read-only. Its lines 54–60 distinguish intact
archive/listing bytes from the shell convenience string losing a leading BOM.
The reported tarstream 128 passes are separate author evidence, not a byte
failure and not rerun or reclassified by this review.

## Mechanism and intended boundary

At the inspected shell hash
`f4b9e55515e00ef456d48f6a3da60cf5b19b5af7fb91c700c151bd92726f6bb7`:

1. `src/shell/shell.ts:75` wraps capture and optional external byte sinks in
   the existing output budget.
2. `src/shell/runtime.ts:103` implements `Capture`: it copies each byte chunk
   and concatenates the copies, without decoding.
3. `src/shell/shell.ts:129` obtains both complete captured byte arrays.
4. `src/shell/shell.ts:132` independently calls `new TextDecoder().decode(...)`
   to materialize `stdout` and `stderr`, then returns the original byte fields.

Consequently `efbbbf41` yields `stdoutBytes`/`stderrBytes` hex `efbbbf41`, but
text `A` rather than `\uFEFFA`. BOM-only `efbbbf` yields an empty string despite
three captured bytes. Both channels exhibit the same behavior; this does not
depend on tar, filesystem contents, command substitution, or shell quoting.

`src/contracts/io.ts:169` has a separate `collectText` helper with a default
decoder. There is no `decodeText` symbol in the inspected contracts, and
`Shell.exec` result materialization does not call `collectText`. Other shell
decoders exist in input, parsing, and command substitution; they are not this
review's proposed edit sites.

The inspected `ShellResult` type declares string and byte fields but does not
specify deliberate BOM removal. The archive README records an observed
limitation, not an instruction to remove BOMs. Preservation is the user's
requested shell text semantics; WHATWG does not itself mandate that policy
for this library's convenience fields.

## Primary decoder semantics

Consulted on 2026-08-27 UTC:

- WHATWG Encoding Standard, [serialize I/O queue](https://encoding.spec.whatwg.org/#serialize-i-o-queue)
  and [TextDecoder](https://encoding.spec.whatwg.org/#interface-textdecoder):
  initial U+FEFF is omitted for UTF-8 when both the ignore-BOM and BOM-seen flags
  are false. Setting `ignoreBOM: true` retains that character; interior U+FEFF
  is not removed by the default decoder either.
- Official [Node TextDecoder API](https://nodejs.org/api/util.html#new-textdecoderencoding-options):
  `ignoreBOM` defaults to false, true includes the BOM in decoded output, and
  `fatal` defaults to false. Streaming decode buffers incomplete sequences.
  The live documentation identified Node v26.8.1; actual tests used v22.22.2.

Tests independently pin literal expected strings and exact byte hex, then
compare default, explicit-false, explicit-true, and streaming decoder baselines.
They do not derive the preservation expectations from the product decoder.

## Bounded regression cases

`\uFEFF` and `\uFFFD` below denote code points, not literal backslash text.
Both stdout and stderr are tested separately. Byte-field/external-sink tests
are separate from text tests, so text failures cannot conceal byte results.

| Case | Joined byte hex | Required text |
| --- | --- | --- |
| Empty | empty | empty |
| BOM only | `efbbbf` | `\uFEFF` |
| BOM + ASCII | `efbbbf41` | `\uFEFFA` |
| BOM + UTF-8 | `efbbbfc3a9f09f9880` | `\uFEFFé😀` |
| Interior BOM | `41efbbbf42` | `A\uFEFFB` |
| Split BOM + UTF-8 | `efbbbfc3a9f09f9880` | `\uFEFFé😀` |
| Repeated BOM chunks | `efbbbfefbbbf41efbbbf` | `\uFEFF\uFEFFA\uFEFF` |
| Invalid UTF-8 | `c328ff` | `\uFFFD(\uFFFD` |
| BOM + invalid UTF-8 | `efbbbfc328ff` | `\uFEFF\uFFFD(\uFFFD` |
| Non-BOM binary | `00fffe8041` | `\0\uFFFD\uFFFD\uFFFDA` |
| Incomplete BOM prefix | `efbb` | `\uFFFD` |

Split chunks include empty writes, `ef` / `bb` / `bf`, `c3` / `a9`, and
`f09f` / `9880`. Additional tests repeat three executions on one shell and
forward equivalent string/byte stdin without decoding it in the command.
The default decoder removes only the first leading BOM in these fixtures;
repeated/interior ones remain. Invalid input replacement remains unchanged.

Two output-budget controls count stdout and stderr together: two BOM-only
writes require six bytes, succeed at cap 6, and reject with
`ShellLimitError("maxOutputBytes")` at cap 5. A pre-aborted execution preserves
the exact abort reason and enters neither the command nor external sinks.
These controls do not assert first-read cancellation, universal host-operation
interruption, or any new lifecycle guarantee.

## JSON is a separate policy

For `efbbbf7b226f6b223a317d`, the direct `JSON.parse` control accepts the default
decoder's `{"ok":1}` but throws `SyntaxError` for the preserving decoder's
`\uFEFF{"ok":1}`. This is a controlled observation, not a request to strip
BOMs globally or change JSON parsing.

The explicit existing `structuredCommands()` plugin is also tested. Plain JSON
produces exact bytes `7b226f6b223a317d0a`. At the first guarded checkpoint,
both string and byte BOM-prefixed JSON inputs failed with exit 5 and
`jq: invalid JSON input at offset 0\n`. The plugin input used its own
`ignoreBOM: true` decoder then. The control pins that observed diagnostic.

Between checkpoints, another worker changed structured command source. The
later bounded probe still rejected BOM JSON with exit 5 and empty stdout, but
reported `jq: Invalid numeric literal\n`. The exact old diagnostic assertion
therefore became a seventeenth failure. It is **not a shell BOM failure**.
No assertion was skipped, weakened, or updated to hide this moving-source
mismatch. Root should coordinate this control with the structured owner after
their checkpoint; do not make a shell fix change JSON semantics to satisfy it.

## Recorded validation

Run only this file:

```sh
node --import tsx --test --test-concurrency=1 --test-reporter=tap tests/shell/bom-capture.test.ts
```

Each test has a two-second timeout; each focused test process was capped at
20 seconds. Additional byte/JSON probes were small and finite. No native,
first-read, full suite, build, or dependency installation was run.

The JSON evidence records timestamps, HEADs, source/test SHA-256 hashes, every
test outcome, decoder code points, and raw byte hex. Source guards hash the
sorted recursive `src` path/hash manifest before and after work. Both recorded
test windows had matching endpoint hashes; hashes changed **between** windows.
Endpoint equality cannot exclude a transient write/revert and is not acceptance
of work still being authored. No post-fix result is claimed.

| Checkpoint | Result | Meaning |
| --- | --- | --- |
| First corrected harness | 64 tests: 48 pass, 16 fail | Twelve leading-BOM text cases plus four repeated-exec/string-byte cases fail. All 22 byte-field/external-sink cases pass. |
| Later final-file verification | 64 tests: 47 pass, 17 fail | Same 16 BOM failures plus the independently changed jq diagnostic. All 22 byte-field/external-sink cases still pass. |
| Scoped typecheck | 1 unowned source error | `src/commands/structured/input.ts:53` uses `String.toWellFormed` outside the configured lib. No new-test diagnostics remain. Not a whole-repo typecheck. |

Both focused runs exit 1 with zero skips, cancellations, or todos. The initial
draft harness incorrectly used `run`/numeric results instead of
`execute`/`CommandResult`; its 12-pass/52-fail result is retained as discarded
harness evidence, not a product result. Two initial new-test sink type errors
were corrected to asynchronous writes before final verification.

## Minimal proposed source fix, not applied

Change only the final text materialization in `Shell.exec`:

```ts
stdout: new TextDecoder("utf-8", { ignoreBOM: true }).decode(stdoutBytes),
stderr: new TextDecoder("utf-8", { ignoreBOM: true }).decode(stderrBytes),
```

Leave `fatal` at its replacement-mode default, leave both byte fields and
external sinks intact, and do not move decoding into per-chunk writes. This
proposal is downstream of existing byte caps and cancellation; the controls
verify their baseline, not a source patch that has not been made. Do not edit
`collectText`, parser/input/substitution decoders, JSON handling, or archive
source as part of this fix. No new runtime dependency or public API is needed.

After the serial owner handoff, rerun the same preservation tests with guarded
source hashes and reconcile the separate structured diagnostic checkpoint.
This review establishes neither broad shell compatibility nor superiority.
