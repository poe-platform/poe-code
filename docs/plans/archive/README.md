# Archived Plans

Archived plans are design history. They are not the source of truth for current
behavior.

- Current work: [Active plans](../README.md)
- Shipped behavior: package READMEs, [development docs](../../development/README.md), and [reference docs](../../README_FULL.md)
- Archive size at this cleanup: 236 Markdown plan documents, including 146 at this directory root

## When A Plan Belongs Here

- The feature shipped and is documented elsewhere.
- The plan was an investigation and its decision record is still useful.
- The direction was superseded by later architecture.
- The remaining work is too small or too stale for a full active plan.

## Find History

Use search instead of browsing the whole archive:

```sh
rg -n "<topic>" docs/plans/archive
find docs/plans/archive -name '*<topic>*' -print
```

## Archive Map

Most archived plans live at this directory root. Subfolders hold specialized
history:

- [`poe-agent/`](poe-agent/): older `poe-agent` architecture and plugin-runtime drafts.
- [`qa/`](qa/): one-off QA plans retained for provenance.
- [`research/`](research/): research notes that supported archived implementation plans.
- [`local-workflows/`](local-workflows/): historical local pipeline, Ralph, and experiment-loop plan docs moved out of `.poe-code`.

High-volume clusters:

- Agent runtimes and integrations: `agent-*`, `poe-agent-*`, `spawn-*`, `provider-*`
- Workflow runners: `pipeline-*`, `experiment-*`, `ralph-*`, `superintendent*`, `maestro*`
- Toolcraft and rendering: `toolcraft-*`, `cmdkit-*`, `markdown-*`
- Infrastructure: `mcp-*`, `e2b-*`, `package-lint*`, `workspace-*`, `worktree-*`

## Archived In This Cleanup

- `codex-openai-provider-configure-investigation.md`
- `harness-worktree-reconciliation.md`
- `portable-agent-config-sync.md`
- `toolcraft-log-levels.md`
- `toolcraft-markdown-code-highlighting.md`
- `toolcraft-markdown-to-html.md`
- `toolcraft-markdown-to-plaintext.md`

Also converted six legacy archived YAML plan files to Markdown wrappers with
the original YAML preserved for provenance.

Moved 75 historical local workflow plan docs from `.poe-code` archives into
[`local-workflows/`](local-workflows/) so planning docs stay under `docs/plans`.

Do not add new active work here. New plans belong in `docs/plans/`.
