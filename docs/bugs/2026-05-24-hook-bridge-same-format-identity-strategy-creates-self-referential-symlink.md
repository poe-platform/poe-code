# Hook bridge same-format identity strategy creates self-referential symlink

## Summary

`@poe-code/agent-hook-config` documents `claude-code` to `claude-code` bridging as an identity symlink used to share hooks between user and project scope. Instead, the supported bridge path resolves both the symlink source and destination at project scope, creating `.claude/settings.json` as a link to itself. The resulting hook file cannot be read and does not expose the existing global Claude hooks.

## Reproduction

From the repository root, run a disposable Vitest probe with valid global Claude hook configuration and no project-local hook file:

```sh
cat > packages/agent-hook-config/src/__probe__.test.ts <<'EOF'
import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { bridgeHooks } from "./bridge-hooks.js";

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("same-format Claude hook bridge", () => {
  it("creates a self-referential project link instead of exposing global hooks", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "hook-self-link-"));
    roots.push(root);
    const cwd = path.join(root, "project");
    const home = path.join(root, "home");
    const globalSource = path.join(home, ".claude", "settings.json");
    const localTarget = path.join(cwd, ".claude", "settings.json");
    fs.mkdirSync(path.dirname(globalSource), { recursive: true });
    fs.writeFileSync(globalSource, JSON.stringify({ hooks: { Stop: [] } }));
    const manifest = bridgeHooks("claude-code", "claude-code", cwd, home, "run-1");
    let readError = "";
    try { fs.readFileSync(localTarget, "utf8"); } catch (error) { readError = (error as NodeJS.ErrnoException).code ?? String(error); }
    console.log(JSON.stringify({ globalSource, symlinkTarget: manifest.symlinkTarget, link: fs.readlinkSync(localTarget), readError }));
    expect(manifest.symlinkTarget).toBe(localTarget);
    expect(fs.readlinkSync(localTarget)).toBe(localTarget);
    expect(readError).toBe("ELOOP");
  });
});
EOF
trap 'rm -f packages/agent-hook-config/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
nl -ba packages/agent-hook-config/src/symlink-hooks.ts | sed -n '131,177p'
nl -ba packages/agent-hook-config/src/bridge-hooks.ts | sed -n '179,190p'
nl -ba packages/agent-hook-config/README.md | sed -n '5,10p;19,23p'
```

## Observed Behavior

The generated project hook link targets its own pathname and reading it fails with a symlink-loop error, while the configured global source is never linked:

```text
{"globalSource":"<tmp>/home/.claude/settings.json","symlinkTarget":"<tmp>/project/.claude/settings.json","link":"<tmp>/project/.claude/settings.json","readError":"ELOOP"}
✓ packages/agent-hook-config/src/__probe__.test.ts > same-format Claude hook bridge > creates a self-referential project link instead of exposing global hooks
```

The supported-pair table identifies `claude-code` to `claude-code` as an identity symlink that should “share between project and user” in `packages/agent-hook-config/README.md:5`. `bridgeHooks()` always invokes `symlinkHooks(..., "project")` for the symlink strategy in `packages/agent-hook-config/src/bridge-hooks.ts:179`. `symlinkHooks()` then resolves both `targetPath` from the source config and `symlinkPath` from the target config using that same project scope in `packages/agent-hook-config/src/symlink-hooks.ts:147`, which are identical for the same agent, before calling `symlinkSync(targetPath, symlinkPath)`.

## Expected Behavior

Same-format identity bridging intended to share user hooks into a project should create a readable project-local link to the existing user/global hook file, or otherwise no-op when the agent already sees the correct source. It must never create a self-referential hook file.

## Impact

Enabling the documented same-agent hook bridge leaves Claude Code with an unreadable project hook configuration and prevents global hooks from being exposed in the spawned project. Safety hooks, automation, and user-defined lifecycle behavior may disappear or cause hook-file loading failures immediately when the bridge is enabled.
