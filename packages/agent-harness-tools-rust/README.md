# agent-harness-tools-rust

Run ordered harness work with a persistent Rust queue and self-contained Node addon.
The package is additive and has no npm runtime dependencies.

- Queue plans and follow-up messages, including plans still being validated.
- Preserve submission order when validation completes out of order.
- Publish frozen snapshots and retain unchanged item identities.
- Pause or cancel between items and retain completed and pending work.
- Normalize workflow participants with the embedded agent catalog.
- Run document workflows, hooks, stages and sequences with injected callbacks.
- Resolve loop agents and map source paths into execution worktrees.

```ts
import { createRunQueue } from "@poe-code/agent-harness-tools-rust";

const queue = createRunQueue({
  plans: ["docs/plans/build.md"],
  afterEachPlan: ["Review the result"],
  cwd: process.cwd()
});
await queue.run({
  async execute(item) {
    console.log(item.kind === "plan" ? item.path : item.text);
    return "completed";
  }
});
```

Rust owns queue ordering, identifiers, cursor, statuses and duplicate admission.
Full item snapshots materialize when read or delivered to listeners; execution
transfers the active item. Queues reject additions above 65,536 items before
mutation. Node owns validation promises, execution callbacks, listeners, abort
signals, path resolution, frozen snapshot caching and document workflow adapters.
The agent catalog is embedded in the same addon. Native artifacts have currently
been validated on macOS arm64.

This first surface does not expose plan storage/discovery, process/runtime
execution, logs, dashboards or workspace transfer. It is not a full replacement
for the original package. Loop-agent callbacks use a structural symbol cancellation
type: original SDK callbacks can be supplied, but the original SDK's unique symbol
prevents the reverse full-module type assignment. Custom array/intrinsic hooks
and invalid untyped outcomes require further compatibility review. Existing
production imports remain unchanged.
