# Env replacement and pinned ordering

## Integrated frozen checkpoint

Sagan runtime954f230 integrates the contract/core caller below. At that exact
committed revision, runtime-acceptance.test.ts passes10/10 (historical2/10 is
retained), and the separate boundary/order/Sagan author cohort passes111/111,
zero skips/TODO. Frozen build, all-source/selected-test typecheck and built
package root nested-env smoke pass. The unchanged six original benchmark rows
now pass6/6 using the original0294afb harness/environment and expectations.
Evidence and reproducible snapshot runners:
`benchmarks/reports/core-fixes-20260827/{six-954f230,env-integration-954f230}.json`.
This is not a whole-product suite, global all-test typecheck or independent
full parity review. Pending/red statements below preserve pre-integration
history; no original report, expected output or failure evidence is overwritten.

`84fc742` adds the approved optional CommandInvokeOptions.replaceEnv and the
core env caller. Thirty focused boundary/legacy tests and global typecheck pass.
True requests an exact exported map (missing env means empty); false/omitted
retains old invocation behavior. Runtime/types remain Sagan-owned. Boundary
tests and registry fallback are not proof that actual Shell replacement works;
the frozen leak row must be replayed after runtime integration.

## Ordering investigation, not benchmark normalization

The actual pinned GNU coreutils9.7 env executable calls putenv for each operand,
then emits environ in physical order. Its included gnulib putenv implementation
prepends newly introduced names and replaces existing slots without moving them.
This explains native B,A for `env -i A=1 B=2`. The earlier assumption that this
was merely Darwin libc behavior was too broad: the inspected gnulib source
provides the relevant rule. This is not universal POSIX or every GNU build's
ordering. Primary references and hashes of the local env.c/putenv.c and binary
are in native-order.json; mutable upstream source is supplementary.

Twenty-three native observations cover inherited values, append versus replace,
duplicate assignments, unsets/re-addition, reversed operands, numeric names,
empty/embedded-equals/newline values, special property names and NUL output.
Before source correction:5/23 pass,18 fail. After:23/23 pass, zero skipped/TODO.
The implementation preserves inherited order and replacement positions, prepends
only newly added names, and prints that physical order. It does not reverse all
final entries or normalize benchmark stdout. Forwarded named values retain their
computed order where the Record-based API can express it; integer-like keys
in an inherited JS Record have JS enumeration order, not arbitrary native envp
ordering. No order guarantee was added to the shared environment contract.

Two old author assertions expected append-new ordering; they now assert the
native-backed prepend-new behavior. Original frozen224 JSON, the six-row4/6
snapshot and the original ordering failure remain unchanged. Direct native
comparisons use exact bytes/status/stderr; no sort-to-green.

Reproduce native capture into a new filename with:

```sh
COREUTILS_ORACLE_ROOT=/path/to/coreutils-9.7 \
node tests/commands/core-env/capture-order.mjs /tmp/env-order-new.json
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/core-env/*.test.ts tests/commands/execution.test.ts \
  tests/commands/core-expanded/regressions.test.ts \
  tests/contracts/invoke.test.ts tests/contracts/stdin-provenance.test.ts
```

The combined boundary/order cohort is80/80 with typecheck passing at this author
checkpoint, before adding `runtime-acceptance.test.ts`. The separate actual-shell
acceptance is2/10 pass,8/10 fail before Sagan runtime integration; zero skips/TODO.
Its committed raw evidence is `runtime-before-integration.json`. The wildcard
command now includes those deliberately visible required failures, so it is
not an80/80 all-green command until runtime integration actually passes them.
Different-agent verification and actual-shell true/empty/unset/export/local
acceptance remain mandatory after runtime integration; no six-row closure is
claimed from these tests. No new runtime dependency or native product process.
