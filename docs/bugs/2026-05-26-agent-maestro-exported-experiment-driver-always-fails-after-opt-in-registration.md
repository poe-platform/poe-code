# Agent Maestro exported experiment driver always fails after opt-in registration

## Summary

`@poe-code/agent-maestro` exports `experimentDriver` as an available opt-in workflow driver and exposes `registerDriver()` for enabling it, but the exported driver's `run()` implementation unconditionally throws `"experiment driver not implemented"`. Consumers can successfully register the advertised workflow kind only for every dispatched experiment task to fail at runtime.

## Reproduction

Create a disposable Vitest probe at `packages/agent-maestro/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import {
  experimentDriver,
  getDriver,
  registerDriver,
} from "./index.js";

describe("exported opt-in experiment driver", () => {
  it("registers successfully but cannot run an experiment task", async () => {
    registerDriver(experimentDriver);

    expect(getDriver("experiment")).toBe(experimentDriver);
    await expect(experimentDriver.run({} as never)).rejects.toThrowError(
      "experiment driver not implemented",
    );
  });
});
```

Run the focused probe, then remove it:

```sh
npm exec -- vitest run packages/agent-maestro/src/__probe__.test.ts --reporter verbose
rm packages/agent-maestro/src/__probe__.test.ts
```

Observed test output:

```text
✓ packages/agent-maestro/src/__probe__.test.ts > exported opt-in experiment driver > registers successfully but cannot run an experiment task
```

## Observed Behavior

The public barrel at `packages/agent-maestro/src/index.ts` exports `experimentDriver` together with `registerDriver()` and `getDriver()`. `packages/agent-maestro/src/drivers/index.ts` states that the experiment driver is available for opt-in registration, and registration succeeds. However, `packages/agent-maestro/src/drivers/experiment.ts` implements `run()` solely by throwing `new Error("experiment driver not implemented")`, so the registered driver cannot process any task.

## Expected Behavior

An exported driver described as available for opt-in registration should execute its corresponding workflow, or the package should not expose it as an available runtime driver until implemented. Registering a public experiment driver should not deterministically install a failing task path.

## Impact

Integrations that enable Maestro experiment dispatch through its documented public registry surface accept and register the workflow successfully, then fail only when a task reaches execution. This converts valid experiment work into deterministic runtime failures and can trigger retries, error handling, or operator intervention instead of running the configured workflow.
