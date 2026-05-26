# Dry-run eval check clones target and runs oracle

## Summary

Running `eval check` with the root `--dry-run` option still clones the configured target repository, copies solution content into the clone, and executes oracle tests.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable local git target and eval fixture, then run its check in dry-run mode:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project" "$probe/target"
(
  cd "$probe/target"
  git init -q
  git config user.email probe@example.test
  git config user.name Probe
  printf 'base\n' > README.md
  git add README.md
  git commit -qm initial
  git branch -M main
)

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts eval init smoke-check --kind plan \
      --target-repo "$probe/target" --target-ref main
)

cat > "$probe/project/smoke-check/oracle/tests/example.test.ts" <<'TEST'
import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("local clone", () => {
  it("contains source file", () => {
    expect(existsSync(join(process.env.CLONE_DIR!, "README.md"))).toBe(true);
  });
});
TEST

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run eval check smoke-check
)

find "$probe/project/runs" "$probe/project/smoke-check/oracle/tests/node_modules" -print
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command exits successfully and prints a passing oracle-test result (`1/1 cases passed`).
- It creates `runs/.check/smoke-check/<timestamp>/clone`, containing a cloned git repository and copied oracle solution output.
- Vitest execution also creates cache output beneath `smoke-check/oracle/tests/node_modules/.vite/vitest`.

## Expected Behavior

With root `--dry-run`, `eval check` must not clone repositories, copy oracle files, execute test processes, or create run/cache output. It should preview the intended check operation only.

## Impact

- A preview can run arbitrary oracle test code and write substantial project artifacts.
- Checks against remote targets could incur network, disk, or execution cost despite dry-run mode.
- Users cannot safely assess eval validation behavior without allowing code execution.

## Supporting Evidence

The root CLI advertises `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `eval` is a forwarded Toolcraft command; `packages/agent-eval/src/cli/commands.ts` calls `runCheckCli` without a dry-run parameter, and `packages/agent-eval/src/check/check.ts` unconditionally creates a clone directory, clones the target, copies files, and invokes its scorer.

## Suspected Area

Forwarded eval commands need root dry-run propagation, with `eval check` short-circuited before cloning or oracle execution.
