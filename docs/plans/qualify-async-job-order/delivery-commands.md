# Reconciled async-order delivery checks

The delivery checkout is `/Users/kjopek/Workspace/poe-code-async-delivery-20260913`, branch `main`, based on fetched remote `8e890a5324a52a76a0a67da6ff0503efda76cb6b`. It uses the existing dependency installation via a node_modules symlink; generated locale data and selected build outputs were generated in the delivery checkout. Vitest uses the maintained local source aliases. Installed registry validation is recorded separately and must not be inferred from that symlink.

1. Reapply the existing atomic commits `26d6b7722`, `cff1a62cd` and `8f6b7826c` onto fetched main. Preserve the remote ledger, append only the qualification commit's task addition when resolving its append conflict. Do not merge the shared workspace's unrelated local commits or dirty changes.
2. Generator check: `npx vitest run packages/safe-js/test/async-generator-return-order.test.ts packages/safe-js/test/async-delegated-return-restore.test.ts packages/safe-js/src/snapshot/async-generator-validation.test.ts` — 22 passed, exit 0. Run `npx eslint` on the five runtime and two test files in that repair — exit 0. Then `git push origin main`, fetch and check HEAD ancestry.
3. Finally check: `npx vitest run packages/safe-js/test/promise-finally-handler-metadata.test.ts packages/safe-js/src/interp/globals/promise-finally-own-then.test.ts packages/safe-js/src/interp/globals/promise-finally-foreign-species.test.ts` — 15 passed, exit 0. Run `npx eslint packages/safe-js/src/interp/promise.ts packages/safe-js/test/promise-finally-handler-metadata.test.ts` — exit 0. Push and verify ancestry separately.
4. Run both twelve-file commands under Maintained checks in [commands.md](commands.md) — 132 passed, zero failed/skipped; lint exit 0. `npm run build:workspaces -- --workspace=@poe-code/safe-js` — exit 0 including postbuild checks. Push qualification and verify ancestry.
5. Execute [reconciled-pinned-command.json](reconciled-pinned-command.json) with the maintained command from the delivery checkout; use a fresh report path. The observed exit 1 is expected evidence of 18 retained nonpasses, not an all-pass result. Independently compare each report result's filename, sourceHash, mode, status and reason with pinned-final.jsonl. Preserve edition 16 and the extension dispositions.
6. Observe `gh run view <id> --json status,conclusion,jobs`, `gh run list`, and registry metadata independently. The initial generator-only root/scoped runs were cancelled before publication to let the queued full-task successors run. The intermediate finally-only pending runs were superseded by GitHub. Verify the successor SHA contains both fixes; do not infer it from the run title.
7. After publication, install the exact registry versions in an independent consumer. Execute the maintained scoped artifact smoke and the literal async traces via original execution, pending restore and completed replay; assert exact host counts and finally-handler arities. Retrieve registry attestations, verify their source commit/workflow binding and tarball integrity. A green workflow alone is insufficient.

Setup dispositions: the first full local clone and remote checkout failed with ENOSPC. Only task-created incomplete checkouts were removed. A sparse checkout recovered; missing lint inputs and generated numberformat data caused initial commands to fail before tests ran. Generated data was restored with `node packages/safe-js/scripts/numberformat-data.mjs`; all maintained lint input paths were materialized. This Git version rejected `git sparse-checkout add --no-cone`; the existing non-cone configuration accepted `git sparse-checkout add`. A lint attempt under `/private/tmp` was interrupted after excessive ancestor traversal (28,530 entries); the identical command succeeded after relocating this task-owned checkout, without changing limits. One GitHub API request timed out; subsequent read-only requests succeeded. No setup failure is counted as a pass.

## Installed scoped artifact receipt

The consumer has a private type-module package.json. Copy the unchanged `scripts/fixtures/safe-packages-*` files from delivered main into it. Download exact registry artifacts using `npm pack @poe-platform/safe-fs@0.1.569 --ignore-scripts --json`, and the corresponding safe-bash/safe-js commands. During the recorded SafeJS propagation gap, fetch its registry tarball URL with a unique read-only query, then verify SHA-512 against both `dist.integrity` and the attestation subject before installing. Do not use a locally built substitute.

Run in that consumer:

```sh
npm install --ignore-scripts --no-audit --no-fund ./poe-platform-safe-fs-0.1.569.tgz
node safe-packages-fs-only.mjs
bun safe-packages-fs-only.mjs
npm install --ignore-scripts --no-audit --no-fund ./poe-platform-safe-bash-0.1.569.tgz
npm install --ignore-scripts --no-audit --no-fund ./poe-platform-safe-js-0.1.569.tgz
node safe-packages-smoke.mjs
bun safe-packages-smoke.mjs
npm audit signatures --json
```

For the nine installed traces, execute the unchanged JavaScript block under “Built Node/Bun runtime traces” in [commands.md](commands.md) on `node --input-type=module` stdin from this consumer, replacing only its runtime import `./packages/safe-js/dist/index.js` with `@poe-platform/safe-js`, and its runtime-traces.json pathname with the absolute evidence pathname. The literal cases and assertions remain unchanged; exit 0, nine pass records, each with two host calls, are recorded in delivery-installed-node-traces.json. Execute the guest source from the first `promise-finally-handler-metadata.test.ts` test using the same installed run/deepCopyFromSandbox exports and Node strict assertions; expected `[1,1,"","",true,true]` passed.

The partial Safe Bash smoke imports Shell, MemoryFileSystem and agentCommands from `@poe-platform/safe-bash/node`, constructs a shell over the memory filesystem, installs agentCommands, executes `printf 'async-order\n'`, asserts exit 0 and stdout `async-order\n`, then awaits shell.dispose(). The executed guest command performs no external filesystem or network operations.

Registry verification fetches each package's `dist.attestations.url`, decodes the SLSA v1 DSSE payload, matches its subject SHA-512 to the downloaded tarball and registry integrity, and checks resolvedDependencies.gitCommit plus runDetails.metadata.invocationId. The separate npm signature audit also passes. A transient GitHub live-unit-log API request returned 404 while that job was running; it was not treated as a failed test or successful log download.

## Installed root artifact receipt

Create a second private type-module consumer. Run `npm pack poe-code@15.0.32 --ignore-scripts --prefer-online --json`, verify its SHA-512 and SLSA subject/source/workflow against the registry, then `npm install --ignore-scripts --no-audit --no-fund ./poe-code-15.0.32.tgz`. `./node_modules/.bin/poe-code --version` must report 15.0.32; `npm audit signatures --json` must exit 0. Execute the same nine-trace block as the scoped check with import `poe-code/safe-js`, retaining every expectation and exact host count. Also run the same finally metadata assertion through that export. All recorded checks passed. The root and scoped release logs are retained as lossless gzip files.
