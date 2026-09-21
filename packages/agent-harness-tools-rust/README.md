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
- Discover workflow documents with project overrides and symlink/traversal checks.
- Discover markdown plans, filter kinds, and sort ready plans before drafts.
- Open plan task lists and archive plans with finalization metadata.
- Summarize completed plans, follow-up messages and pending work.
- Generate distinct plan log directories and UTC role filenames.
- Reject log directories whose canonical ancestors escape the state directory.

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

Workflow discovery keeps filesystem access, platform path normalization, Unicode
lowercasing and locale sorting in Node. Rust selects default globs, matches names,
checks normalized containment and merges project/global entries by exact filename.
Supply your filesystem adapter through `discoverWorkflowDocs({cwd, homeDir,
subDirectory, fs})`; discovery ignores missing directories and symbolic links.

This surface does not expose process/runtime execution, log streaming, dashboards or workspace transfer. It is not a full replacement
for the original package. Loop-agent callbacks use a structural symbol cancellation
type: original SDK callbacks can be supplied, but the original SDK's unique symbol
prevents the reverse full-module type assignment. Custom array/intrinsic hooks
and invalid untyped outcomes require further compatibility review. Existing
production imports remain unchanged.

A local injected-filesystem benchmark of 128 discoveries with 64 entries per
scope takes about 9–10 ms native versus 5–6 ms in TypeScript. This surface does
not currently show a performance advantage; real filesystem latency is additional.

Use `ensureSafeRunLogDir({planPath, runner, homeDir, fs})` to create a log
directory through your filesystem adapter. With `realpath`, it checks existing
ancestors before creating the final directory and validates the result afterward.
Without `realpath`, checks are lexical. Rust formats ASCII labels and UTC filename
components; Node supplies SHA-256, platform paths, dates and filesystem operations.

Use `discoverPlans({cwd, homeDir, planDirectory, fs})` to list plans or
`archivePlan({...options, id, metadataPatch})` to archive one. The owned task-list
SDK and its Rust codecs share the harness addon. Node retains filesystem access,
metadata hooks and display-path sorting; Rust selects file IDs, validates readiness
and formats readiness labels and queue summaries. Broader YAML editing limits of
the owned task-list implementation still apply.

A local memfs benchmark of 32 discoveries over 32 markdown plans takes about
34–38 ms native versus 58–65 ms in TypeScript. This scoped result does not establish
performance on other filesystems or platforms.
