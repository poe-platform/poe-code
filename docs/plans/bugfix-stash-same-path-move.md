# Reject agent-stash copy/move onto the same local path

## Scope

- Edit only this plan and `packages/agent-stash/src/operations/copy-move.ts` and `copy-move.test.ts`.
- Leave commits, pushes, and release monitoring to the parent.
- No README edits, inline comments, CLI styling changes, real-filesystem fixtures, network, or Gist operations.

## Confirmed failure

Project and global Claude paths coincide when `cwd` equals `homeDir`, including normalized roots such as `homeDir + '/.'`. Scope labels differ, so validation currently accepts these operations. A skill move writes the same directory before deleting it, including supplemental files. Hook moves can delete the selected hook or change its identity, while copies can rewrite or duplicate hooks. Backups do not prevent loss of live data.

## TDD sequence

1. Add deterministic memfs regressions for validation and execution, copy and move, both local directions, exact and normalized roots, skills with supplemental files, and hooks with fresh or tracked origins.
2. Require an explanatory same-local-path error, unchanged full memfs contents, and zero filesystem mutation calls. Keep distinct-root success controls.
3. Run the tests red before editing production code.
4. In shared preparation, immediately after retargeting, reject only when both endpoints are local and their `path.resolve(targetPathForItem(...))` values match. Reject before backups, origin-cache writes, or other mutations; do not compare only context roots.
5. Run focused tests, the agent-stash package suite, targeted ESLint, and package typechecking. Record results here.

## Validation results

- Red: `node_modules/.bin/vitest run packages/agent-stash/src/operations/copy-move.test.ts --reporter=dot` — 48 same-path regressions failed because the promises resolved instead of rejecting; 37 tests passed, including all 16 distinct-root controls. Production code was unchanged.
- Green: the same focused command passed all 85 tests after the eight-line shared preparation guard (606 ms overall).
- Package suite: `npm run test --workspace=agent-stash -- --reporter=dot` — 469 tests passed across 12 files (27.30 s overall).
- Targeted lint: `node_modules/.bin/eslint packages/agent-stash/src/operations/copy-move.ts packages/agent-stash/src/operations/copy-move.test.ts` — passed.
- Package typecheck: `node_modules/.bin/tsc -p packages/agent-stash/tsconfig.json --noEmit` — passed.
- Production and test typecheck: `node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --resolveJsonModule packages/agent-stash/src/operations/copy-move.ts packages/agent-stash/src/operations/copy-move.test.ts` — passed.
- Scoped `git diff --check` — passed.
- Regression fixtures use only memfs and verify every exposed filesystem mutation method remains uncalled, preserving skills, supplemental files, hook settings, and origin caches without creating backups. No new Gist or network operations; existing in-memory remote controls still pass.
- No CLI styling changes or screenshots; rejection text is asserted directly. No commits, pushes, or releases performed.
