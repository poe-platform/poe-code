# Private cancellation helper extension evidence

The pre-code freeze is commit
`88d91975e4a718fb3c1b55322e44492cf4059391` (tree
`4abec3e42e1f07d6b8c60a1d316e3f9a3e816b4c`). The source-only candidate is
commit `373437cf84424939e1792470805cdd9e60bd3898` (tree
`8e9037f29aa030406cffb7595371041c91c08ae7`). Its helper is blob
`3b7b55abc14718c0e23aa0c352af392b967a4905`, SHA-256
`f628801379acd1c86c247a778e973f4cb89f8bbe2c3089f8192c31f3c5b273a5`.

The frozen extension has 38 literal policy controls exercised by 22 author
tests. A versioned post-freeze supplement adds the one successful-activation
replay assertion that E17 required but the frozen author test only covered on
the failure path. The supplement does not change a frozen byte or expectation.

Final scoped results are extension 22/22, success-replay supplement 1/1,
unchanged Stage 1 author 22/22, and unchanged repair 5/5. These are separate
cohorts and are not aggregated into a broader claim. Extension strict,
extension negative-type, supplement strict, unchanged Stage 1 strict and
negative-type, isolated helper build, and emitted-module import all exited 0.
The emitted JS/declaration hashes and exact commands are in `checks.json`.

The first candidate runtime already passed 22/22, while its three TypeScript
controls each failed on the same local `unknown` annotation. The exact diagnostic
and exits are retained in `initial-candidate-type-failure.txt`; the final source
annotation correction did not alter frozen fixtures.

Resource closure is checked through listener counts after failed activation,
successful parent-capacity reacquisition after rollback, idempotent close, and
termination of every test/type/build child process. Generated `.build` output was
removed after its hashes and imports were verified. No AGENTS file, public
export, Runtime/Shell/contracts/types/cleanup/input/output file, package/config,
timeout/deadline API, Stage 2 design, or original frozen fixture was changed.

The strict selector accepts an observed origin only after exact helper-owned
lineage membership and reason consistency. The test-local registrar separately
demonstrates invocation, raw-Promise, boundary and one-shot report binding. It is
not Runtime integration. Equal or falsy reasons, sibling origins, replacement or
async-adopted Promises, mapped errors, and numeric status do not prove an
escaping cancellation. R08 is represented only as the approved ordinary
error-to-status disposal boundary; no integrated R08/R09/R10 result is claimed.

The irreducible limitation remains explicit: arbitrary async wrappers can lose
Promise identity, so an otherwise equal escaping rejection stays unrelated.
Runtime-owned `InvocationCancellationOwner` and its outcome channel remain
design-only and require a different review before any Runtime write.

