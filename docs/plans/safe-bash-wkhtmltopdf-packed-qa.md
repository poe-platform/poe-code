# wkhtmltopdf packed-export QA receipt — 2026-09-18

Audit/documentation task: ship-wkhtmltopdf. Existing dirty implementation and unrelated edits were preserved. No runtime, manifest, builder or shared-contract changes were made by this task. HEAD: `052940a62255aa620236474575b4003a2df76549`; this receipt covers the working tree, not a clean commit or release.

## Repeatable manual procedure

1. Run `npm run test:unit --workspace=safe-bash-command-wkhtmltopdf` and `npm run lint --workspace=safe-bash-command-wkhtmltopdf`.
2. Build the selected closure using `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
3. Run the maintained `scripts/package-safe.mjs` with an explicit temporary output directory and verification version, then `npm pack --ignore-scripts` the generated safe-bash and safe-fs artifacts. Never publish the private command package.
4. Install those tarballs with lifecycle scripts disabled into an isolated directory outside the repository. Confirm neither private contracts nor command workspace is installed. Import the public command subpath and root; compare command runtime identity with the exported contracts owner. Exercise parser, help and missing-renderer rejection.
5. Use memory VFS plus a mocked renderer to exercise actual Shell-created argv, binary file output, SDK stdout parity and renderer retirement. Mock output bytes establish stream behavior only, not PDF validity.
6. Compile a strict TypeScript consumer with NodeNext, then Bundler resolution with browser and workerd custom conditions. Bundle the root and command together for each web condition and execute with aligned byte/encoder constructors and standard web globals, without Buffer, process or host I/O.
7. Parse every shipped JS/declaration file with the TypeScript AST and reject bare private workspace references. Inspect the README flag table against exported switch declarations. Purge temporary evidence after recording results.

## Results

| Verification | Result |
| --- | --- |
| Command unit route | 84 passed; zero failures/skips |
| Command lint and production/test typechecks | Passed |
| Maintained selected workspace build closure | Passed, including native postbuild route |
| Isolated tarball root/subpath import and shared contract identity | Passed |
| Parser, help and missing-renderer rejection | Passed |
| Actual Shell argv, memory VFS binary output, SDK stdout parity and close count | Passed with mocked renderer |
| Strict NodeNext declarations | Passed |
| Browser and workerd Bundler declarations | Passed |
| Browser/workerd condition bundles without Buffer/process/host I/O globals | Passed |
| AST scan of shipped JS/declarations | 1,222 files; no private workspace specifiers |
| Private workspace packages installed in consumer | Neither |
| Switch reference | All 122 declarations, aliases, scopes, operand counts and dispositions retained |

Verification safe-bash tarball SHA256: `516f20826419d422004ebea918a6d9c828d28522fcf31ce804f7820d0d1d63c4`. Version: `0.0.0-ship-verification`. Runtime: Node v22.22.2. The artifact retains other existing Safe Bash dependencies; the private command manifest itself has an empty runtime dependency map. This is not a claim that all of Safe Bash has zero runtime dependencies.

Initial browser probe omitted the standard performance global, and an earlier IIFE probe used top-level await; corrected harnesses passed. A CommonJS resolver probe could not resolve an ESM-only export; the actual ESM import passed. These harness failures are not suppressed product results. The temporary consumer lived outside the checkout to prevent ancestor workspace resolution. Literal filesystem `/out` was read-only, so generated artifact/log evidence used repository `out/ship-wkhtmltopdf`, consistent with existing task receipts; isolated consumer scratch was also purged.

No renderer is included or qualified. No native patched-Qt execution, actual workerd execution, browser fidelity, TOC/XSLT convergence, generated PDF screenshots or replay invariant qualification is established. No rendering or visible CLI behavior changed, so screenshot rendering checks were inapplicable. Existing Markdown rendering qualification gates remain open. Only documentation changed; full repository unit/lint routes were not rerun, and earlier broad-gate failures are not recast as passes. No local commit, push, remote-main verification, publication or release occurred.

## Independent repeat verification — 2026-09-18

Repeated against the same HEAD and existing working-tree implementation. The maintained command unit route passed all 84 tests; command lint and production/test typechecks passed. The selected maintained safe-bash build closure passed, including postbuild. Three additional Shell boundary tests passed for binary pipelines/VFS scripts, redirect effects and distinct HTTP failure statuses.

New tarballs were generated through `scripts/package-safe.mjs` and `npm pack --ignore-scripts`, then installed with lifecycle scripts disabled into a fresh directory outside the checkout. Neither private workspace was installed. Public root/subpath imports, shared command runtime identity, help, missing-renderer rejection, memory-VFS binary file output, SDK stdout parity and renderer close counts passed. Strict declarations passed with NodeNext and with Bundler browser/workerd conditions, without skipping declaration checking. Browser/workerd bundles executed help with no Buffer or process globals; these are condition-selected VM controls, not actual browser or workerd execution.

The AST scan checked 1,222 shipped JS/declaration files with no private workspace references. All 122 flag rows matched declaration names, short aliases, scopes, operand counts and dispositions. The initial table probe expected the raw disposition instead of the documented `rejected: resource` label; correcting that probe passed without changing product code or documentation.

This verification tarball SHA256 is `a156ec8475c83b201d4600bf19de6f0cf5f71a41d9fbaab84849b37f75e86657`, version `0.0.0-ship-verification`, Node v22.22.2. Temporary artifacts and consumer probes were purged after inspection. `/out` creation failed because the filesystem is read-only, so temporary evidence used the existing repository `out/` convention.

Review found no necessary code simplification or new validated defect in the command ownership/export wiring, direct host-access checks, failure-output isolation, cancellation, resource budgets or cleanup paths covered above. No code, shared infrastructure, rendering, CLI visuals or snapshot/version behavior changed during this repeat; full repository routes and screenshots were therefore not rerun. Renderer qualification and native compatibility remain unestablished as documented, rather than unresolved defects introduced by this documentation task. No commit, push, publication or release was performed.

## Current ship-wkhtmltopdf verification — 2026-09-18

Executed the Markdown procedure against HEAD `052940a62255aa620236474575b4003a2df76549` and the preserved dirty implementation. Documentation now gives explicit renderer-free help, extended-help and version command examples, and names those actions in the existing Safe Bash support row. No product code, configuration, rendering or CLI presentation changed.

- Passed: all 84 maintained command unit tests, command lint and production/test typechecks; selected maintained safe-bash workspace build closure (11 builds, including postbuild); all three existing Shell boundary tests.
- Passed: fresh tarball installation outside the checkout with lifecycle scripts disabled and neither private workspace installed; root/subpath imports; missing-renderer rejection; parser negative controls for equals syntax, invalid DPI, misplaced global flags and dynamic JavaScript; actual Shell memory-VFS binary output, SDK stdout parity and two renderer closes for two acquisitions.
- Passed: strict declaration checking without `skipLibCheck` under NodeNext and Bundler browser/workerd conditions; condition-selected browser bundles executed help in a VM without Buffer/process globals. This is not actual browser or workerd execution.
- Passed: TypeScript AST inspection of 1,222 shipped JS/declaration files found no private command/contracts specifiers; all 122 documented flag names, aliases, scopes, operand counts and dispositions matched exported declarations.
- Harness failures: an accidental nonexistent-workspace pack command failed before producing an artifact; the first declaration fixture incorrectly supplied synchronous stdin instead of the public async byte-source contract; the first flag-table probe used incorrect property names. Corrected probes passed without changing product code. These initial runs remain failures, not product defects.
- Not run: full repository gates (documentation-only changes); CLI/document screenshots (no visible or rendering change). Unverified: native patched-Qt compatibility, actual browser/workerd execution, renderer/PDF fidelity, TOC/XSLT convergence and checkpoint/replay.

The safe-bash tarball reproduced SHA256 `a156ec8475c83b201d4600bf19de6f0cf5f71a41d9fbaab84849b37f75e86657`, version `0.0.0-ship-verification`, Node v22.22.2. Generated evidence used repository `out/ship-wkhtmltopdf-current` because literal `/out` is not writable; the isolated consumer and generated evidence were removed after inspection. No local commit, push, remote-main delivery, publication or release was performed. The command package remains private with an empty runtime dependency map.
