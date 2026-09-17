# Python capability diagnostics (#752)

## Scope

Provide portable configuration preflight and typed, sanitized host failures for
the existing dedicated-worker integration. Do not invent a Cloudflare executor,
retained-directory contract, untrusted isolation or runtime compatibility proof.
Those remain separate issues. No README changes are authorized by this work.

## Reproduction and implementation

The initial factory regression reproduced generic shell internal-error output.
The first diagnostics draft also swallowed caller checkpoint exceptions and
left raw cleanup failures escaping the registered cleanup barrier. Focused tests
reproduced both before the narrower fixes.

Host factory, endpoint transport, runtime loader/ABI, filesystem ENOTSUP,
capacity and cleanup failures now have stable categories. Raw causes go only to
an explicit diagnostic observer. Arbitrary caller/control exceptions retain
their identity; cancellation still takes precedence. Cleanup reports once and
preserves admission capacity when retirement cannot be established.

Preflight checks requested capabilities only; absence of retained open does not
block inline code. Directory support is explicitly unavailable pending #749.
Shared-memory structural checks are not runtime or deployment qualification.

## Validation

- Focused red evidence: `/tmp/poe-752-followup-red-visible.log` (six regressions)
  and `/tmp/poe-752-cleanup-red-visible.log` (two cleanup regressions).
- Focused green evidence: `/tmp/poe-752-verified-unit.log`, 175 Python and public
  export tests, including checkpoint identity, binary/stream contracts, lifecycle
  and recovery. Independent worker review reproduced and fixed a direct exit
  notification transport-classification gap.
- Maintained source/test and public consumer typecheck passes, including all 26
  current consumer groups: `/tmp/poe-752-verified-types.log`. The initial run
  identified missing design-system build prerequisites and a test-only cleanup
  callback type mismatch; both are corrected.
- Selected workspace build closure, root bundling and standalone packaging pass.
  Fresh installed candidate `0.1.653-issue752` passes three real public Node
  tests: failed-loader recovery, memory and quota profiles, binary streams and
  awaited worker termination. Evidence: `/tmp/poe-752-public.log`.
- The same installed artifact bundles for browser/workerd without Node
  compatibility. Workerd 2026-07-08 passes the maintained portable preflight
  fixture, run in an existing read-only network-disabled container because the
  host libc is older than workerd's requirement. Evidence:
  `/tmp/poe-752-workerd.log`; browser bundle size is 1,559,221 bytes.
  This tests unsupported-host diagnostics, not Python execution on Cloudflare.
- CLI screenshot inspected after rebuilding the missing node-pty dependency:
  `screenshots/bash-root-tmp-poe-752-cli-root-python-trusted-python-runtime-file-missing-runtime.mjs-c-python-c-pass.png`.
  The error names runtime/package assets without printing the loader exception.
- Guarded ESLint passes with zero errors and two existing warnings; final
  inventory/lint verification includes the new maintained workerd fixture.

## Portable fixture procedure

Install the local standalone tarballs in a fresh consumer. Bundle
`packages/safe-bash/tests/integration/python-diagnostics-workerd/worker.mjs` with
esbuild using the consumer's resolution directory, `platform: browser`, ESM and
the `workerd`/`browser` export conditions. Place `bundle.mjs` beside a copy of
the fixture's `config.capnp` in a temporary directory, then run
`workerd test config.capnp`. Do not run against source aliases or enable Node
compatibility to bypass the portable export surface.

## Delivery

Commit `ed40be6df` was pushed and independently verified on remote main before
#752 was closed. Its first scoped workflow failed the separate Pandoc/PDF README
gate. After the README fix landed in `aee265445`, scoped workflow `35247726840`
succeeded and published version `0.1.653`; the npm version and `latest` tag were
verified. The separate `poe-code` CLI release remains independently monitored.
