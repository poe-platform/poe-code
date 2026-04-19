---
kind: pipeline
vars:
  plan_doc: "{{file 'docs/plans/consolidate-planning-docs.md'}}"

tasks:
  - id: plan-browser-kind-model
    title: Replace PlanSource with PlanKind and PlanEntry in plan-browser
    prompt: |
      Replace the PlanSource model in `packages/plan-browser/src/types.ts`
      with a kind-centric model. Backwards compatibility is NOT required —
      delete the old types.

      Deliverables:
      - Add a `PlanKind` union: `"plan" | "pipeline" | "experiment" | "ralph" | "superintendent" | "superintendent-base"`.
      - Add a `PlanEntry` shape with: `path`, `absolutePath`, `kind`,
        `typeLabel`, optional `runner`
        (`"pipeline" | "experiment" | "ralph" | "superintendent"`),
        `title`, `detail`, `updatedAt`, `format` (`"markdown" | "yaml"`),
        optional `schemaUrl`.
      - Delete `PlanSource` and anything that exists only to prop it up.
      - Re-export the new types from the package entry point.
      - Update call sites in this package to stop referencing `PlanSource`.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: plan-browser-discovery
    title: Discover and classify plans by kind in plan-browser
    prompt: |
      Update `packages/plan-browser/src/discovery.ts` to scan the shared
      plan directory and classify each doc by its frontmatter `kind`.

      Rules:
      - Scan only the shared plan directory resolved from
        `plan.plan_directory` (default `docs/plans/`). Do NOT scan legacy
        per-harness directories — delete that code path.
      - `kind` in frontmatter is required and authoritative.
      - If `kind` is missing on a plain `docs/plans/*.md`, classify as
        `kind: plan` (generic five-altitude design doc).
      - If `kind` is missing on any other doc shape, error loudly. No
        heuristic fallbacks.
      - Include superintendent docs and generic plain-markdown plan docs —
        both are currently invisible to `poe-code plan list`.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: plan-browser-formatters
    title: Per-kind detail formatters in plan-browser
    prompt: |
      Update `packages/plan-browser/src/format.ts` so each kind renders its
      own detail summary, with a generic fallback for `kind: plan`.

      Target column shape (terminal output):
        Kind | Type | Name | Detail | Updated

      Examples to support:
      - `plan`               — "design doc" or first-heading summary
      - `pipeline`           — `done/total` task progress
      - `experiment`         — `<metric-direction> · <status>`
      - `ralph`              — `<agent> · <status>`
      - `superintendent`     — `review <n>` or current phase summary
      - `superintendent-base` — "base doc" (not runnable)

      Also update the JSON output shape returned from the package so
      consumers can access `kind`, `typeLabel`, `runner`, and `detail`.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: cli-plan-list-kind
    title: Surface kind/type in poe-code plan list and filters
    prompt: |
      Update `src/cli/commands/plan.ts` so list/view/filter work by `kind`.
      `source`-based classification is deleted.

      Deliverables:
      - Accept `--kind <kind>` on `poe-code plan list` and
        `poe-code plan browse` (values: plan, pipeline, experiment, ralph,
        superintendent, superintendent-base).
      - Render Kind and Type columns in terminal output and include them
        in the JSON output.
      - Include superintendent docs and generic plain-markdown plan docs
        in the listing.
      - Remove any code that still treats `source` as the primary
        classification.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: config-shared-plan-directory
    title: Make plan.plan_directory the only planning directory setting
    prompt: |
      In `src/services/config.ts`, make `plan.plan_directory` the single
      source of truth. Delete per-harness aliases.

      Deliverables:
      - `plan.plan_directory` default is `docs/plans`.
      - Every harness (pipeline, experiment, ralph, superintendent) reads
        `plan.plan_directory` directly — no fallbacks.
      - Delete `pipeline.plan_directory`, `experiment.plan_directory`,
        `ralph.plan_directory`, and `superintendent.plan_directory` from
        the config schema and from every reader.
      - Delete `pipeline`'s extra `.poe-code/pipeline/config.yaml` `planPath`
        handling and any code that consults it.
      - Do NOT introduce a `plan.plan_path` sticky path — deferred.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: superintendent-shared-plan-dir
    title: Superintendent default discovery uses the shared plan directory
    prompt: |
      Update `packages/superintendent/src/commands/run.ts` (and any other
      superintendent entry points) so default discovery uses the shared
      plan directory from `plan.plan_directory`.

      Deliverables:
      - Default to `docs/plans/` via the shared config.
      - Delete the `.poe-code/superintendent` default and any fallback
        code that resolves it.
      - Align with the superintendent skill which already expects
        `docs/plans/<name>.md`.

      Runtime-state mutation of `status` inside the doc is out of scope
      here — do not change it.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: schema-exports-packages
    title: Export code-first document schemas from owning packages
    prompt: |
      Add code-first JSON Schema exports next to the owning parser in each
      package. These exports are the source of truth that the build-time
      codegen step consumes.

      Deliverables:
      - `@poe-code/pipeline` exports `pipelineDocumentSchema` and
        `pipelineDocumentSchemaId`.
      - `@poe-code/experiment-loop` exports `experimentDocumentSchema` and
        `experimentDocumentSchemaId`.
      - `@poe-code/ralph` exports `ralphDocumentSchema` and
        `ralphDocumentSchemaId`.
      - `@poe-code/superintendent` exports `superintendentDocumentSchema`
        and `superintendentBaseDocumentSchema` plus their ids.
      - Core (`poe-code`) exports `planDocumentSchema` and
        `planDocumentSchemaId` for generic `kind: plan` docs.

      Schema ids use the pattern:
      `https://poe-platform.github.io/poe-code/schemas/plans/<kind>.schema.json`.

      Do NOT wire the build codegen or GitHub Pages publication yet —
      those are separate tasks.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: schema-codegen-script
    title: Generate JSON Schemas into docs/schemas/plans/ at build time
    prompt: |
      Add a codegen script under `scripts/` that consumes the schema
      exports from each owning package and writes JSON Schema files into
      `docs/schemas/plans/`.

      Deliverables:
      - Script emits deterministic output for:
        - `plan.schema.json`
        - `pipeline.schema.json`
        - `experiment.schema.json`
        - `ralph.schema.json`
        - `superintendent.schema.json`
        - `superintendent-base.schema.json`
      - Script is invoked by `npm run build` (or a dedicated `codegen` step
        the build depends on).
      - Add a CI freshness check that regenerates schemas and fails if the
        working tree diff is non-empty.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: schema-github-pages
    title: Publish docs/schemas/** via GitHub Pages
    prompt: |
      Add a GitHub Pages publish workflow that serves `docs/schemas/**`
      under `https://poe-platform.github.io/poe-code/schemas/...`.

      Deliverables:
      - New workflow under `.github/workflows/` that builds and publishes
        `docs/schemas/` to Pages on push to `main`.
      - Published URLs match the ids declared in the schema exports task,
        i.e. `.../schemas/plans/<kind>.schema.json`.
      - Lint workflows with `npm run lint:workflows` before committing.

      Do NOT write unit tests for the workflow.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: writers-canonical-frontmatter
    title: Writers emit canonical kind, version, and snake_case fields
    prompt: |
      Make every document writer emit the canonical frontmatter shape.
      Legacy camelCase aliases are deleted on both read and write.

      Deliverables per package (`packages/pipeline`, `packages/experiment-loop`,
      `packages/ralph`, `packages/superintendent`):
      - On write, emit:
        - `$schema: <kind schema id>`
        - `kind: <kind>`
        - `version: 1`
      - Field names are snake_case, period:
        - `max_experiments` (delete `maxExperiments`)
        - `metric_timeout` (delete `metricTimeout`)
        - `plan_path` (delete `planPath`)
      - Readers accept only snake_case. Delete camelCase branches.
      - Experiment writer: document (only if non-obvious) why `status` in
        frontmatter is not treated as runtime state — the journal sidecar
        remains authoritative.

      Full design context:
      {{plan_doc}}
    status:
      implement: done
      refactor: done
      test: done
      commit: open

  - id: templates-default-docs-plans
    title: Harness templates default to docs/plans with canonical metadata
    prompt: |
      Update the skill templates so every `poe-code <harness>` creation
      path writes into the shared plan directory and emits canonical
      metadata.

      Deliverables:
      - `src/templates/plan/SKILL_plan.md` — new generic plan docs emit
        `kind: plan` + `version: 1` and default output path to
        `docs/plans/<name>.md`.
      - `src/templates/experiment/SKILL_experiment.md` — default output
        path to `docs/plans/<name>.md`, emit `kind: experiment` +
        `version: 1` + snake_case fields.
      - Pipeline template — default to `docs/plans/plan-<name>.md`, emit
        `kind: pipeline` + `version: 1`.
      - Superintendent template — keep `docs/plans/<name>.md`; emit
        `$schema` + `kind` + `version: 1` consistently.

      Do NOT rewrite README files in this task.

      Full design context:
      {{plan_doc}}
    status:
      implement: open
      refactor: open
      test: open
      commit: open
---

## Context

This pipeline executes the consolidation described in
[consolidate-planning-docs.md](consolidate-planning-docs.md). The design
doc is injected into every task prompt via the `plan_doc` var.

Backwards compatibility is explicitly not a goal: legacy per-harness
directories, camelCase field aliases, and heuristic-based classification
are all deleted. `kind` is required in frontmatter; `plan.plan_directory`
is the only planning-directory setting.

## Acceptance signals

- `poe-code plan list` shows Kind + Type columns and includes generic
  plan docs and superintendent docs from `docs/plans/`.
- `docs/schemas/plans/*.schema.json` is generated by `npm run build` and
  CI fails when stale.
- GitHub Pages serves `/schemas/plans/<kind>.schema.json`.
- New docs created by each harness land in `docs/plans/` with `$schema`,
  `kind`, and `version: 1` in the frontmatter.
- Legacy per-harness directories and camelCase aliases are gone from the
  codebase.

## Explicitly out of scope

- Unifying runtime-state persistence (experiment journals vs in-doc
  status mutation).
- A sticky `plan.plan_path` setting — deferred.
- Rewriting README files.
