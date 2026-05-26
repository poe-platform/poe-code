# Plan browser displays unreadable experiment journal as open state

## Summary

`@poe-code/plan-browser` derives an experiment's displayed state from its adjacent journal file, but catches every journal read failure and reports the experiment as `open`. Permission errors and other I/O failures are therefore represented as a normal initial state rather than surfaced as unavailable status data.

## Reproduction

From the repository root, run a disposable Vitest probe that supplies a valid experiment document while making its state journal unreadable:

```sh
cat > packages/plan-browser/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { readPlanMetadata } from "./format.js";

describe("plan browser experiment journal failures", () => {
  it("reports an unreadable experiment journal as an open experiment", async () => {
    const document = [
      "---",
      "kind: experiment",
      "metric:",
      "  name: score",
      "  direction: maximize",
      "---",
      "# Tune model"
    ].join("\n");
    const metadata = await readPlanMetadata({
      kind: "experiment",
      absolutePath: "/repo/docs/plans/tune.md",
      path: "docs/plans/tune.md",
      fs: {
        async readFile(filePath) {
          if (filePath.endsWith(".journal.jsonl")) {
            throw Object.assign(new Error("EACCES: permission denied"), { code: "EACCES" });
          }
          return document;
        }
      }
    });
    console.log(JSON.stringify(metadata));
    expect(metadata.detail).toContain("open");
  });
});
EOF
trap 'rm -f packages/plan-browser/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
nl -ba packages/plan-browser/src/format.ts | sed -n '264,275p;327,334p'
nl -ba packages/plan-browser/README.md | sed -n '9,15p'
```

## Observed Behavior

An `EACCES` failure while reading the experiment journal is silently rendered as the ordinary `open` state:

```text
{"title":"Tune model","detail":"open","format":"markdown"}
✓ packages/plan-browser/src/__probe__.test.ts > plan browser experiment journal failures > reports an unreadable experiment journal as an open experiment
```

The package advertises normalized detail strings and previews in `packages/plan-browser/README.md:9`. `readExperimentState()` attempts to read the sidecar journal but returns `"open"` for every thrown error in `packages/plan-browser/src/format.ts:264`, without distinguishing a missing journal from an unreadable or failed read. `readPlanMetadata()` then renders that fallback as the displayed experiment detail in `packages/plan-browser/src/format.ts:327`.

## Expected Behavior

A missing journal may reasonably indicate a new `open` experiment, but a journal that exists and cannot be read should surface an error or unavailable-status indicator. The browser should not claim a normal workflow state when it failed to observe the authoritative state source.

## Impact

File permission changes, transient storage failures, or damaged workspace mounts can cause in-progress, completed, or failed experiments to appear as newly open in the plan list. Users may restart work, misprioritize experiments, or overlook failures because the browser silently replaces unknown state with a plausible but false status.
