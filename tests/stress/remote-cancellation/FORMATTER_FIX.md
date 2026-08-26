# Independent formatter correction

August 26, 2026. Scope: only `tests/stress/remote-cancellation/**`.

## Reproduced reporting failure, not a product defect

The pre-fix `run.mjs` is byte-identical to original audit commit
`4e26ce0d386b9f3fcd25c3d540b5d43361b056d3` (also its last-change commit).
Its Git blob is `cf9b195dd706bc0846ed2ecacca989e0a0886a84`; SHA-256 is
`ece894130bcd7e8a969cfde8590cc332e3dd7f8ab3c449e4d492f3ac1cf1aed5`.
No later runner change explains the reported bug.

`formatter-prefixed-failure.json` is immutable and contains exact stdout,
stderr, timestamps, command, and before/after identity. It records **audit
child exit 0, wrapper exit 1**, with `SyntaxError` from `JSON.parse` at
`run.mjs:41:29` while rendering S08. Remaining case totals were not rendered;
this failed invocation is not full-audit acceptance evidence.

```sh
env -u AUDIT_VERBOSE -u AUDIT_CASE NODE_OPTIONS='--import=tsx --import=./tests/stress/remote-cancellation/recheck90ddc74-register.mjs' AUDIT_REPEATS=1 node tests/stress/remote-cancellation/run.mjs
```

The capture had a 75-second outer deadline and the original runner's unchanged
60-second process-group watchdog. It finished normally without timeout. Product
source was read from `90ddc748f21e2164ea3f20e47f32bbdad6a5b20c` through the
test-only Git loader, including the root command barrel and WebDAV HTTP mock.
The loader verifies that `3731587fa287333ca59c7a81569b367cec66f61d` is an
ancestor, resolves pinned product modules without worktree fallback, transpiles
in memory using existing development TypeScript, and logs their committed hashes.
The original nonverbose renderer suppressed those source log lines; the later
revalidation capture records them. No product file was edited or checked out.

The reproduction script initially asserted the wrong error class after writing
the actual immutable capture: it expected `TypeError`, but the observed failure
is `SyntaxError`. That verifier-only assertion was corrected, not the capture.
`formatter-reproduce.mjs` deliberately refuses to run against a modified runner
or overwrite the capture. It documents the pre-fix invocation, not an instruction
to replace the now-fixed runner with historical bytes.

## Root cause and limited fix

Node v22.22.2's actual built-in TAP reporter escapes backslashes and hashes in
diagnostic messages. Directly JSON-parsing the TAP line either changes backslash
values silently or fails when an event contains quoted JSON stdout (S08/D08).
The formatter removes exactly that transport escaping before JSON parsing; it
does not alter assertions, event values, typed outcomes, or cleanup expectations.

The normal renderer retains **every original raw line**, including complete
diagnostics, source identities, failure details and stderr, and adds the familiar
case summaries. Non-string JSON event values (including serialized Uint8Array
objects) are retained in raw diagnostics and excluded only from string-prefix
counters. Malformed JSON/shape diagnostics remain visible, emit a formatter
error, and cause wrapper exit 1 instead of being silently accepted. Child status
and process/watchdog logic are unchanged. Verbose rendering is unchanged.

```sh
node --unhandled-rejections=strict --test tests/stress/remote-cancellation/format.test.mjs
git diff --check -- tests/stress/remote-cancellation
```

Final focused formatter result: **5/5, zero failures/skips/cancellations**, exit
0. The initial test run was 4/5 because the native-reporter control inherited
`NODE_TEST_CONTEXT` and received Node's binary test protocol rather than TAP.
The control now clears that child-only environment variable. No product or
frozen semantic test was changed. The regression covers native reporter output,
quoted output, Unicode/control/backslash/hash preservation, JSON byte arrays and
mixed event values, malformed diagnostics, and retention of all raw data.

## Historical evidence and freeze distinction

`evidence.json`, `REPORT.md`, `remote-cancellation.test.ts`, `helpers.ts`,
`capture.mjs`, and `tsconfig.json` remain byte-identical to `4e26ce0`.
Only the original **runner formatter** changes. The existing `3731587` evidence,
loader, recorder and supplement are untouched. Their historical all-seven-file
guards were true at capture time; a new invocation of `handoff-verify.mjs` now
correctly rejects the changed runner. Do not reinterpret that guard as a product
regression or rewrite historical artifacts. New revalidation separately guards
the six frozen original artifacts and the explicitly authorized runner revision.

This correction does not close the extra `head -n 0` case when upstream stalls
before its first nonempty write (Sagan's assignment, still needs caller cancel),
prove universal cancellation, remote rollback, full-shell support, or superiority.
Full post-fix acceptance is recorded separately from this formatter commit.
