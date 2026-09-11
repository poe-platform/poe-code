# PR 719: drain admitted owned output writes

## Requested result

Integrate the reviewed fix from PR #719, head `083401179359459036afd37ff0293aeba5aadc3f`, into main. Closing an output operation must wait for writes already admitted to its explicitly enrolled `ownedOutput` destination, including when caller cancellation has settled the public write promise. Opaque destinations retain their existing behavior. Closing one output does not grant ownership over sibling outputs or cancel the command context.

## Validation and ownership

The implementation owner first applies the PR's regression tests to current main and records the failing behavior, then applies the reviewed change to `src/contracts/output.ts`. The new pending-write record must be enrolled before invoking host code. Close waits for enrolled writes and registered cleanup concurrently, so cleanup can release a held write. Caller cancellation remains prompt and its reason identity is preserved.

Root coordinates this plan, Git integration, validation scope, push, and GitHub release monitoring. The leaf owns the two changed source/test files. Existing tests are extended rather than replaced; preserve their canonical inventory registration. No unrelated source or historical evidence is changed.

Use the focused owned-output, output-contract, and shell lifecycle tests to establish RED/GREEN. Run maintained checks covering the affected package and public packed consumers before delivery. Record exact results and distinguish local commit, verified remote main, and successful publication. No public signature or visual formatting change is intended.

## Review evidence

Independent review of the latest PR head found no concrete ownership regression and confirmed both changed files still matched the PR base on main. The latest PR's shell, packed Node/Bun, and end-to-end checks passed; its broader unit CI contained nine five-second timeout cases across six other files. These failures are not dismissed as flaky. Current main's complete maintained unit run passed before integration, including the original 19-case replay test and its formerly slow `co` case in 1.705 seconds. Revalidate the changed output behavior on the integrated candidate rather than relying on the older PR run.

## Candidate evidence

Applying only the PR tests reproduced three failures: cancellation drain, multiple admitted writes, and reentrant close during admission. The exact reviewed implementation then passed all 165 focused tests across owned-output drain, invocation cleanup, output accounting and bounds, filesystem output and task reactions, and LLM lifecycle. The maintained contract suite separately passed all 445 tests with no skips. Both source/test files match the reviewed PR blobs.

The normal workspace build, all 26 SafeBash consumer-type groups, root type checks, and workflow lint passed. Guarded repository ESLint covered all 10,775 configured files with zero errors or warnings. These are completed focused and static checks, not a full candidate qualification.

The root shared-infrastructure rule requires a fresh complete maintained `npm test` because this output contract serves multiple command families. Independent review confirmed this scope; targeted coverage and packed witnesses do not replace the full route. Create a local candidate commit to bind archive checks, then run full tests without competing source changes or CPU-heavy work. After tests, run the normal build again to restore portable browser bundles before the current packed-consumer qualification. Push and release remain pending those gates.

## Completed local qualification

The first full run on `6464b23f302430a8b54c314c29b15a29237815d6` stopped after one native hazard-worker timeout. Its error omitted the scenario. Bounded measurements did not reproduce that timeout or justify a bundling optimization. The separately reviewed diagnostic change in `8b4307c165deef72698d5ea0b755ac2a704b2cef` preserves the original deadline and error cause; its historical-image transition and focused evidence are recorded in [the diagnostic plan](hazard-worker-failure-diagnostics.md). This does not establish the cause of the original timeout.

The complete maintained `npm test` subsequently passed on clean `8b4307c165deef72698d5ea0b755ac2a704b2cef`: shared tests 22,465 passed with two maintained skips; Python 29 passed; Bash runner checks 313 passed and reviewed parallel checks 125 passed; Bash serial tests 31,118 passed with 86 maintained skips and no failures; SafeJS 21,663 passed with 37 maintained skips; terminal tests 288 passed; root post-test checks two passed. The hazard timeout did not recur. The command completed successfully through its native post-test stage, rather than stopping at a package result.

The updated test sources passed all 26 SafeBash consumer-type groups, including the three expected negative diagnostics. Guarded repository ESLint again passed all 10,775 configured inputs with zero errors or warnings. Earlier root type and workflow lint checks remain applicable to their unchanged inputs.

After full tests, the normal workspace build passed and restored browser bundles. Current packed-consumer validation then passed all 35 declared stages, including root and scoped Node/Bun consumers, public types, browser bundle execution, publication witnesses, CLI help, legacy compatibility, and filesystem-only consumers. Every stage exited successfully with its owned process group absent. Tracked input inventories, path inventories, and clean diffs matched before and after qualification. The candidate remained clean and unchanged throughout these checks. Local qualification is complete; remote-main delivery and successful publication must be verified separately.
