# Remove the built-in SafeJS Git feature

## Scope and base

- Base: d51d2c796b314a55d3865435ba1e06bbda578818, parent e91ecba8bdd56c4dd9285a3bc64336ce479aec84.
- Implemented only in /tmp/safejs-remove-git.udF17Y/source. The retained source, original checkout, refs, index, dependencies and other owners' work remain untouched.
- Remove modules/git.ts, makeGitModule, built-in Git replay policies, demo Git stubs and root harness Git injection. No compatibility stub or replacement capability.
- Preserve agent, FS, MCP, environment, harness, metric, logging, Bash and repository/worktree operations. The example experiment retains metric/attempt selection but no longer promises commit or rollback.

## TDD and validation

1. Thirteen removal assertions failed on the intact feature: SDK export, implementation import, eight default replay policies, CLI, example runner and root harness injection.
2. All thirteen pass after removal. Generic replay/tag/error/ordering assertions remain, using agent.spawn or explicit neutral effects/reader fixtures rather than a built-in Git policy.
3. Two additive experiment controls exercise the actual Markdown script and its fallback, including scores, attempts, final result and log count. Existing generic lint and serialized module-name fixture strings are retained; arbitrary strings are not bundled Git support.
4. The final focused cohort comprises 15 complete files: 438 passed, zero failed/skipped on Node 18.20.8, 22.23.2 and 24.14.0. Run one worker with the recorded isolated Vitest config. Detailed commands and raw JSON/stderr are in the accompanying evidence.
5. An expanded Node 22 diagnostic run had 1614 passes, 16 setup failures and 33 existing skips. The 16 were source/dist alias and /tmp versus /private/tmp mismatches, not production failures: canonical source resolution fixes both affected files, 61/61 unchanged controls pass. This is not a claim of a full workspace gate.
6. Actual root-derived strict type checking uses the matched source aliases, no emit and inherited skipLibCheck=true. Production diagnostics: zero. Existing test diagnostics: 44 before and after, no introduced diagnostics, verified by a CompilerHost overlay of the exact saved preimages including deleted git.ts. No unrelated type edits or weakened compiler flags.
7. Formatting is checked against baseline. Three pre-existing unformatted files remain untouched outside owned hunks (harness.ts, harness-command.test.ts, sandbox-integrity.test.ts); the new harness block is range-formatted. All other surviving changed files pass Prettier.

## Deleted coverage

- Intentionally delete 24 Git-only module tests with the implementation, including subprocess command selection, savepoints, cleanup, commit/revert and worktree confinement. Their original titles and hashes are retained in evidence/deleted-coverage.json.
- Intentionally delete the single Git worktree default-policy test (three operation assertions), since those defaults no longer exist. Preserve the general side-effect tagging test under agent.spawn, its payload and all issue/resume assertions.
- Add 13 removal assertions and two experiment preservation controls. Do not call the deleted Git feature tests passing or silently discard generic negative coverage.

## Feynman integration and release

- Apply source.incremental.patch once, hunkwise against the verified base; check every manifest preimage. Do not replace whole current-main runtime files or discard later owner changes.
- This is a breaking public API/default capability removal. Suggested message: feat(safe-js)!: remove built-in Git module. Release/commit/push belongs to Feynman, not this worker.
- Root README/package.json/package-lock/workflows were not changed. No Git-only dependency or package export key exists in the SafeJS package manifest, so no lock or manifest deletion is required by this patch. Keep dependencies still used by repository/worktree features.
- Checked project SKILL\_\* templates contain no built-in Git module/import/factory documentation to remove. Preserve repository git-log guidance and interpreter checkpoint instructions. No template modification or generated-skill sync is needed for this slice; if Feynman changes templates separately, use the maintained sync-skills route.
- Run maintained integrated build/test/release gates after composition, not a root-only shortcut. Clean package outputs before build and verify packed SDK exports/declarations contain no makeGitModule or stale modules/git runtime/declaration file. Keep canonical/legacy SafeJS routes and other capabilities unchanged.
- CLI help is captured as real text, with Git removed from its stub list. The local freeze screenshot executable is unavailable; final CLI screenshot acceptance remains with Feynman's integrated environment, without adding screenshot tests or dependencies.
- No real agent/LLM calls, mutating Git operations, filesystem-writing unit fixtures, installs, builds, commits or pushes were performed by this worker.
