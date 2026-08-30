# Diagnostic runner typecheck checkpoint — 2026-08-26

## Scope and actual fix

Only this directory is owned. The executable change is one guard in `run.ts:11`:
`typeof output === "string" && output.startsWith("/tmp/")` replaces optional
chaining. Current `process.argv[2]` is `string | undefined`; the previous
`assert.ok(output?.startsWith("/tmp/"))` did not narrow `output` for
`existsSync(PathLike)`. TypeScript 5.9.3 reproduced exactly:

```text
shell-stress/diagnostic-profiles/run.ts(12,25): error TS2345: Argument of type 'string | undefined' is not assignable to parameter of type 'PathLike'.
  Type 'undefined' is not assignable to type 'PathLike'.
```

No cast/non-null assertion, profile, provenance, expectation, manifest, runtime
dependency, independent test, or product-source change. The fresh-/tmp-output
requirement and both assertion messages are unchanged. This is not a path
security/atomic-publication enhancement. The other new files are this note and
`typecheck-validation.json`, which retains command outputs and hash guards.

## New validation, not the frozen audit

| Check | Exit/result |
| --- | --- |
| Before: `npm --prefix benchmarks run typecheck` | 2, TS2345 above |
| After: same benchmark typecheck | 0 |
| After: `npm run typecheck` | 2, foreign invocation-mode test helper errors below |
| After: `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.build.json` | 0; no emitted build |
| Focused nonnative output-argument probe | 0, 6/6 |

Root errors are `tests/shell-stress/invocation-modes/refresh.ts:52:7` TS7034
and `:88:13` TS7005: `records` implicitly has `any[]` type. Route to its
independent owner/root; do not alter that file or Curie's manifests here. These
are newly observed moving-worktree type errors, not the nine native mismatches,
the five custom lifecycle failures, or proof of invocation runtime defects.

The focused probe parses actual `run.ts` with the existing development
TypeScript API, selects only the output declaration and next two assertions,
and evaluates those statements in a Node VM with stubbed `existsSync`.
It checks missing, empty, relative, outside-/tmp, existing-/tmp, and fresh-/tmp
arguments, error code/message first line, and filesystem call count/arguments.
No benchmark imports, native executables, shell executions, output creation, or
lifecycle tests run. Initial probe exit 1 was its own too-strict comparison of
Node's assertion message (Node appends `true !== false`); the corrected probe
checks the unchanged first message line and `ERR_ASSERTION`. That initial
validation-harness failure is preserved, not counted as a product failure.

Validation HEAD was `7d0fe7b45578cfc3836e9a8d6a5fd4a4d5e9edd3` before/after, with foreign
worktree changes present. All six pre-existing owned files and contents of the
796 selected source/config files stayed unchanged across the successful probe
and compiler commands; aggregate
`6c37c869b6cdb46ffe25a06d888b13dea8ba989229ae079c3884d069dfd49c93`.
This guards the selected path set, not an atomic repository snapshot or later
foreign changes. No full suite/comparator, emitting tsc, native/profile frozen
cohort, first-read cohort, or current invocation cohort was rerun. All owned
synchronous compiler children exited; no background jobs or subagents started.

## Frozen historical nine: exact names, scripts and differences

Dirac evidence commit `96db59ac7d355d1a94422634b4c4f53d00932ad9` describes
**DIRTY `57d9d9860bd51fabd910814efeea4efbca0e4c26`**, not current source or
committed-HEAD acceptance. Read-only inputs:

- `benchmarks/reports/current-integration/HANDOFF.md`, SHA-256
  `d5db673d469c8ce266caf09a85850b85deca31d2b172fcdc29c896d9d1fe929f`.
- `clean-test.nonpass.json` in that directory, SHA-256
  `0dfb5f4b8cfc3505e2bb5de15c214e88f08d3a12a167716068f74e87bcc58543`;
  TAP line numbers below refer to its `clean-test.stdout.log` positions.
- `clean-benchmark-typecheck.stdout.log`, SHA-256
  `d6c725f02f256f8fe9498a2a66ba2130452f9a1815625f3f62e3ba49cb0d6302`.

The unchanged native helper selects `/bin/bash` 3.2.57 with argv0
`shell-stress`. Current source/tests were inspected, not run:
`src/shell/runtime.ts:433` formats line-bearing diagnostics;
`runtime.ts:1209` retains the NUL-removal warning;
`src/shell/parser.ts:382` parses nested substitution before execution and maps
its syntax error to 127; `src/shell/shell.ts:89` parses each unit before running
it, and `:122` emits its syntax context. The nine definitions remain in
`tests/shell-stress/cases.ts` and `current-gaps/cases.ts`. Shell source has no
diff from frozen `21a6b91` at inspection.

Read-only exact JSON comparison found **all nine audited virtual observations**
(status, stdout/stderr bytes and files) equal their existing stored
`primary-5.3`, argv0 `shell`, repetition-1 capture in
`native-baseline.json` (SHA-256
`0cb9d0b498331434ec2a49dd4f75b30dcfb10db2ff8fd029613d948f119d4cf3`).
Existing `README.md`/`BASELINE.txt` already explain seven diagnostic/profile
differences and two same-unit behavior differences. This classifies historical
evidence; it does **not** prove nine current passes, nine fixes, or current
native parity. The original nine remain failures against their original oracle;
none becomes a new authorized exception. No additional source defect is proved
by this inspection; unresolved parity and independently reported source gaps
remain separate. Do not alter NUL behavior or weaken parse-unit validation here.

### 1. remaining-gap independent Bash: move-output-really-closes-source

Command (audit TAP line 67562):

```sh
{ printf moved >&4; printf lost >&3; printf 'status=%s' "$?"; } 3>saved 4>&3-
```

- Native stderr (JSON): ``"shell-stress: 3: Bad file descriptor\n"``
- Virtual stderr (JSON): ``"shell: line 1: 3: Bad file descriptor\n"``
- Existing diagnostic/profile difference: both exit 0, stdout "status=1", identical file snapshots.

### 2. remaining-gap independent Bash: move-input-really-closes-source

Command (audit TAP line 67624):

```sh
{ IFS= read -r value <&4; printf '<%s>' "$value"; IFS= read -r missing <&3; printf 'status=%s' "$?"; } 3<input 4<&3-
```

- Native stderr (JSON): ``"shell-stress: 3: Bad file descriptor\n"``
- Virtual stderr (JSON): ``"shell: line 1: 3: Bad file descriptor\n"``
- Existing diagnostic/profile difference: both exit 0, stdout "<first>status=1", identical file snapshots.
- Initial files: {"input":"first\nsecond\n"}.

### 3. remaining-gap independent Bash: prevalidation-prior-output-and-file

Command (audit TAP line 67722):

```sh
printf before; printf marker >marker; printf "%s" "$(true |)"; printf after
```

- Native stderr (JSON): ``"shell-stress: command substitution: line 1: syntax error: unexpected end of file\n"``
- Virtual stderr (JSON): ``"shell: -c: line 1: syntax error near unexpected token `)'\nshell: -c: line 1: `printf before; printf marker >marker; printf \"%s\" \"$(true |)\"; printf after'\n"``
- Existing same-parsing-unit policy difference, not stderr-only: native exit 0, stdout "beforeafter", files {"marker":{"type":"file","base64":"bWFya2Vy"}}; virtual exit 127, stdout "", files {}.

### 4. remaining-gap independent Bash: fatal-parameter-preserves-only-earlier-effects

Command (audit TAP line 67788):

```sh
printf before >before; : "${missing:?stop}"; printf after >after
```

- Native stderr (JSON): ``"shell-stress: missing: stop\n"``
- Virtual stderr (JSON): ``"shell: line 1: missing: stop\n"``
- Existing diagnostic/profile difference: both exit 127, stdout "", identical file snapshots.

### 5. Bash differential: nested-substitution-syntax-error-does-not-prevent-earlier-effects

Command (audit TAP line 68864):

```sh
printf touched >marker; printf '%s' "$(true |)"
```

- Native stderr (JSON): ``"shell-stress: command substitution: line 1: syntax error: unexpected end of file\n"``
- Virtual stderr (JSON): ``"shell: -c: line 1: syntax error near unexpected token `)'\nshell: -c: line 1: `printf touched >marker; printf '%s' \"$(true |)\"'\n"``
- Existing same-parsing-unit policy difference, not stderr-only: native exit 0, stdout "", files {"marker":{"type":"file","base64":"dG91Y2hlZA=="}}; virtual exit 127, stdout "", files {}.

### 6. Bash differential: fatal-parameter-expansion-prevents-following-file-effect

Command (audit TAP line 68945):

```sh
: "${missing:?stop}"; : >after
```

- Native stderr (JSON): ``"shell-stress: missing: stop\n"``
- Virtual stderr (JSON): ``"shell: line 1: missing: stop\n"``
- Existing diagnostic/profile difference: both exit 127, stdout "", identical file snapshots.

### 7. Bash differential: fatal-arithmetic-expansion-prevents-following-file-effect

Command (audit TAP line 68996):

```sh
: "$((1/0))"; : >after
```

- Native stderr (JSON): ``"shell-stress: 1/0: division by 0 (error token is \"0\")\n"``
- Virtual stderr (JSON): ``"shell: line 1: 1/0: division by 0 (error token is \"0\")\n"``
- Existing diagnostic/profile difference: both exit 1, stdout "", identical file snapshots.

### 8. Bash differential: fatal-expansion-in-substitution-stops-substitution-only

Command (audit TAP line 69048):

```sh
value=$(printf "%s" "${missing:?stop}"; printf wrong); printf "<%s>:%s\n" "$value" "$?"
```

- Native stderr (JSON): ``"shell-stress: missing: stop\n"``
- Virtual stderr (JSON): ``"shell: line 1: missing: stop\n"``
- Existing diagnostic/profile difference: both exit 0, stdout "<>:1\n", identical file snapshots.

### 9. Bash differential: command-substitution-removes-nul-bytes

Command (audit TAP line 69152):

```sh
value=$(printf "a\0b"); printf "<%s>\n" "$value"
```

- Native stderr (JSON): ``""``
- Virtual stderr (JSON): ``"shell: line 1: warning: command substitution: ignored null byte in input\n"``
- Existing diagnostic/profile difference: both exit 0, stdout "<ab>\n", identical file snapshots.

## Frozen historical five: custom lifecycle, not native parity

`tests/shell/remote-close.test.ts` launches hard-deadline children;
`tests/shell/first-read-probe.ts:96` constructs
`${producer} | head -n 0; true`. Middleware waits until the producer starts
before permitting head to finish. Each failure waits before its first byte and
hits the fixture's internal 1200ms deadline, not a successful cancellation.
The curl port below is allocated by the HTTP fixture, not a fixed literal port.

- **hard-deadline pipeline close: first-read-local** (TAP line 73772): `pending-stream | head -n 0; true`; injected local pending byte source; exact error `DEADLINE: first-read-local (1200ms)`. Child exit 1, expected 0.
- **hard-deadline pipeline close: first-read-s3** (TAP line 73808): `cat /input | head -n 0; true`; injected S3 getObjectStream Body; exact error `DEADLINE: first-read-s3 (1200ms)`. Child exit 1, expected 0.
- **hard-deadline pipeline close: first-read-webdav** (TAP line 73845): `cat /input | head -n 0; true`; fixture WebDAV HTTP body; exact error `DEADLINE: first-read-webdav (1200ms)`. Child exit 1, expected 0.
- **hard-deadline pipeline close: first-read-curl-body** (TAP line 73882): `curl http://127.0.0.1:<fixture-port>/dav/input | head -n 0; true`; fixture curl HTTP body after headers; exact error `DEADLINE: first-read-curl-body (1200ms)`. Child exit 1, expected 0.
- **hard-deadline pipeline close: first-read-curl-headers** (TAP line 73918): `curl http://127.0.0.1:<fixture-port>/dav/input | head -n 0; true`; fixture curl HTTP response before headers; exact error `DEADLINE: first-read-curl-headers (1200ms)`. Child exit 1, expected 0.

These are five separate custom host/transport observations, not Bash-comparison
failures or unsupported `read -N` cases. The frozen standalone
`first-read-head-zero` control passed; the closure cohort was 20/25. Fixture
teardown aborts are not acceptance rescue. No shared output-lifecycle/lease API
is approved; route future lifecycle work through root to shell, curl and adapter
owners. Public `FsError.code` belongs at the filesystem API boundary
(`src/contracts/errors.ts:45`), not as a required serialized errno in native
CLI diagnostics. No diagnostic or assertion normalization is made here.

## Separate newer invocation evidence and limits

Read-only `tests/shell-stress/invocation-modes/POST_READY.md` reports frozen
`21a6b91` holdouts 69/72 (`sh-posix-special-assignment`, `path-command-v`,
`path-type`) and author 130/132 (bash/sh `stdin-read-one-byte`, unsupported
`read -N`). Its raw primary 48/57 also has nine losses, but that is a
**different nine-case denominator**, not Dirac's old nine listed above. It
retains a red final source guard after foreign filesystem movement. Those
owner-reported results were not executed, accepted, or merged into this batch;
its earlier noEmit successes do not replace this batch's root exit 2.

No source/dot/eval work, NUL fix, lifecycle API, fixtures/oracle update, current
full-suite/benchmark execution, full-shell/provider completion, superiority
claim, or 72-hour completion is made. Root owns all follow-up coordination.
