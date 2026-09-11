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
