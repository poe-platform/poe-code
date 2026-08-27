# Explicit external verifier v2: preparation and execution

August 27, 2026. Harness `f231144c`; product/config/inventory remain
`8670ebe8f0d39966c2de2638780437398e5f8490`. External verifier is separately
`c800c899114c6c83b3d3eb67231176d124abaf49`, SHA256
`09d04680a1dd80059fd31da73068c919bb0402d8bdd31a4d0a971a67d8e1259c`.

This preparation originally preceded TAP independent acceptance and execution.
Subsequently `daf7ae4c` accepted the exact dispatch with31/31 controls while
preserving the helper-only29/30 characterization. The authorized fresh cohort
then executed: see `attempt-v2/README.md` for the actual16-group/package result
and its separate qualifications. Config fixture91d56dbe was not overlaid into
8670 by this package cohort.

At preparation the sole actual package run was failed `attempt-v1` (`2b26defd`), with
19 strict groups/70 names/25 imports/four workflows/types passing but16 runtime
groups and source-denial blocked by option9; later controls were not reached.
That output and original harness remain byte-unchanged.

## Transformation and control scope

`external-verifier-v2.mjs` reads exactly the committed c800c899 verifier and
requires its pinned hash. Five relative helper import specifiers alone become
file URLs into authenticated8670 helpers. Reversing those five replacements
must recover the original verifier exactly. Helper contents must match the
fresh archive's Git-bound input manifest. The original consumer mapping,
runtime coverage, snapshot/finish functions and associated inventory/config
remain the frozen helper graph, not moving checkout imports.

Transformed verifier and driver live outside the source archive. The original
snapshot function creates its normal nested8670 consumer/build tree; it does
not receive a changed verifier file inside its committed source. The driver
records product and verifier identities separately. All selected helpers,
transformed bytes and driver hashes are included in its receipt and checked
after execution. The actual original verifier in the archive is never edited.

`run-v2.mjs` retains the v1 candidate/runtime/native admission and package tests,
but invokes that external driver. It requires the produced package SHA to equal
the preserved8670 tarball
`96d8256f3d763caa5442ba27b44e6b1f586d82d83d07d7d10369bed12426b5c1`,
and checks it again after consumers/fallback controls. There is no new whole
suite or actual-engine execution. Existing guard and Node24 qualification are
unchanged. Tracked-source integrity scope remains explicitly non-append-proof.

Author preparation controls: **8/8**, zero product executions. They check exact
reversible imports, untouched frozen helper/original-verifier bytes, changed or
missing helpers, same-byte symlink refusal, missing bindings, source-internal
overlay refusal and exclusive output creation. This stages a bounded helper
fixture; it is not a full fresh archive admission or package invocation. All
owned control scratch was removed. `OVERLAY_RECEIPT.json` authenticates the
helper/runner/control sources and raw output.

## Authorized command after source acceptance

Use a new exclusive output, never attempt-v1 or the mutated whole-gate v4 tree:

```sh
TREE_NATIVE_BIN=/tmp/safe-bash-tree-external-oracle-TbVJVK/tree \
/Users/kjopek/.nvm/versions/node/v24.11.1/bin/node \
  tests/integration/full-gate-20260827/package-only-8670/run-v2.mjs \
  /tmp/safe-bash-package-8670-20260827-v2
```

Report all16 runtime groups, exact negative types, source-denial, moved public
imports/70 names and missing-runtime controls independently of historical
whole-suite counts. Any failed phase is preserved, not treated as acceptance.
