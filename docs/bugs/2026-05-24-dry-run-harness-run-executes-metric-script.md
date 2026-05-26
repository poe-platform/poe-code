# Dry-run harness run executes metric scripts

## Summary

Running `harness run` with `--dry-run` still executes metric scripts referenced by the harness. A disposable metric script that writes a marker file runs successfully during dry-run, proving that arbitrary npm-script side effects are not suppressed.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint

## Reproduction

From the repository root, create a disposable project with a metric script and a minimal harness pair:

```sh
probe=$(mktemp -d)
mkdir -p "$probe/home" "$probe/project/harness"

cat > "$probe/project/package.json" <<EOF
{"scripts":{"metric:touch":"printf executed > '$probe/marker.txt'; printf '\\n42\\n'"}}
EOF

cat > "$probe/project/harness/probe.md" <<'EOF'
---
kind: probe
version: 1
---
# Probe
EOF

cat > "$probe/project/harness/probe.ajs" <<'EOF'
import { run } from "metric";
export default async () => {
  const value = await run("touch");
  return { value };
};
EOF

(
  cd "$probe/project"
  HOME="$probe/home" npx --prefix /path/to/poe-code tsx \
    --import /path/to/poe-code/scripts/register-template-loader.mjs \
    /path/to/poe-code/src/index.ts --dry-run --yes harness run harness/probe.md
)

cat "$probe/marker.txt"
```

Replace `/path/to/poe-code` with the repository checkout path.

## Observed Behavior

- The command reports that it ran `harness/probe.md` and returns `{ "value": 42 }`.
- The marker file exists and contains `executed`, proving `npm run metric:touch` executed during dry-run.

## Expected Behavior

With `--dry-run`, running a harness must not execute metric scripts or any other host-side operation capable of writing files or invoking external actions. It should lint/preview the harness without executing it.

## Impact

- A dry-run harness can execute arbitrary npm scripts and their filesystem, process, or network side effects.
- Users cannot safely inspect a harness before executing custom metrics.
- CI dry-run checks may unintentionally mutate environments or incur external costs.

## Supporting Evidence

The root CLI documents `--dry-run` as `Simulate commands without writing changes.` in `src/cli/program.ts`. `src/cli/commands/harness.ts` resolves dry-run flags but calls `runHarnessPair` unconditionally, and its `metric` module delegates to `container.commandRunner("npm", ["run", scriptName])` without a dry-run guard.

## Suspected Area

`harness run` needs an explicit dry-run mode that prevents module side effects, especially `metric` and `agent` execution.
