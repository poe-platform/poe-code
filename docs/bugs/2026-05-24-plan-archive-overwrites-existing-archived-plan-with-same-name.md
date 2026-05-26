# Plan archive overwrites existing archived plan with same name

## Summary

The plan-browser archive action moves an active plan into an `archive/` child directory using the original basename without checking whether that destination already exists. Archiving a replacement plan with a reused filename silently overwrites the previously archived document and permanently destroys its historical contents.

## Reproduction

From the repository root, run a disposable Vitest probe that archives `feature.md` when an older `archive/feature.md` already exists:

```sh
cat > /tmp/plan-browser-archive-overwrite-probe.test.ts <<'EOF'
import { Volume, createFsFromVolume } from "memfs";
import { describe, expect, it } from "vitest";
import { archivePlan } from "./actions.js";

describe("plan archive collision", () => {
  it("overwrites an existing archived plan with the same basename", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({
      "/repo/docs/plans/feature.md": "# Active version\n",
      "/repo/docs/plans/archive/feature.md": "# Historical version\n",
    }, "/")).promises as any;

    const archivedPath = await archivePlan({ absolutePath: "/repo/docs/plans/feature.md" }, fs);
    const archived = await fs.readFile(archivedPath, "utf8");
    let activeExists = true;
    try { await fs.readFile("/repo/docs/plans/feature.md", "utf8"); } catch { activeExists = false; }
    console.log(JSON.stringify({ archivedPath, archived, activeExists }));
    expect(archived).toBe("# Active version\n");
    expect(activeExists).toBe(false);
  });
});
EOF
cp /tmp/plan-browser-archive-overwrite-probe.test.ts packages/plan-browser/src/__probe__.test.ts
trap 'rm -f packages/plan-browser/src/__probe__.test.ts' EXIT
cat > /tmp/vitest-plan-browser-probe.config.mjs <<'EOF'
export default { test: { include: ['packages/plan-browser/src/__probe__.test.ts'], testTimeout: 10000 } };
EOF
./node_modules/.bin/vitest run --config /tmp/vitest-plan-browser-probe.config.mjs --reporter verbose
nl -ba packages/plan-browser/src/actions.ts | sed -n '32,45p'
nl -ba src/cli/commands/plan.ts | sed -n '445,475p'
```

## Observed Behavior

The destination archive file now contains the newly archived active plan, and the previous historical contents are no longer present:

```text
{"archivedPath":"/repo/docs/plans/archive/feature.md","archived":"# Active version\n","activeExists":false}
✓ packages/plan-browser/src/__probe__.test.ts > plan archive collision > overwrites an existing archived plan with the same basename
```

`archiveSelectedPlan()` builds `archive/<basename>` and invokes `fs.rename(...)` directly in `packages/plan-browser/src/actions.ts:34` through `packages/plan-browser/src/actions.ts:45`. The CLI calls that helper for the user-facing archive action in `src/cli/commands/plan.ts:457` through `src/cli/commands/plan.ts:468`, without any collision prompt, refusal, or unique destination naming.

## Expected Behavior

Archiving a plan should preserve any prior archived document with the same filename, either by refusing the collision, requesting explicit overwrite confirmation, or generating a unique archived filename.

## Impact

Users who reuse common plan names such as `feature.md` or `fix.md` can silently lose previously archived planning history during an ordinary archive operation. The data loss is irreversible through the application because the overwritten archive content is not retained elsewhere.
