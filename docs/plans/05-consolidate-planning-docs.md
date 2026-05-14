# Consolidate planning documents

Unify planning-document discovery, metadata, schemas, and config across `plan`, `pipeline`, `experiment`, `ralph`, and `superintendent` without breaking existing docs all at once.

## 1. Problem

Planning docs are currently fragmented in four different ways:

- **Discovery is directory-driven, not document-driven.**
  - `pipeline` discovers `.poe-code/pipeline/plans` or `pipeline.plan_directory`.
  - `experiment` discovers `.poe-code/experiments` or `experiment.plan_directory`.
  - `ralph` discovers `.poe-code/ralph/plans` or `ralph.plan_directory`.
  - `superintendent` discovers `.poe-code/superintendent` by default, but its skill, tests, and docs already bias toward `docs/plans`.
- **`poe-code plan list` is source-centric and incomplete.** It only knows `pipeline | experiment | ralph`; `superintendent` is missing, and generic `poe-code plan` docs in `docs/plans/` are missing too.
- **Frontmatter shape is inconsistent.**
  - `superintendent` already requires `kind: superintendent`.
  - `ralph` and `pipeline` do not require `kind`.
  - `experiment` has no `kind`, and its documented `status` block is not actually part of the parsed/written frontmatter contract.
  - field naming is mixed: `maxExperiments`, `metricTimeout`, `planPath`, `max_rounds`, `review_turn`.
- **There is no generated published schema for plan documents.** Build and release already exist, but there is no schema codegen step, no `docs/schemas/` output, and no GitHub Pages publication path.

Concrete repo evidence from this investigation:

- `src/cli/commands/plan.ts` only accepts `pipeline`, `experiment`, or `ralph` as `PlanSource`.
- `packages/plan-browser/src/types.ts` defines `PlanSource = "pipeline" | "experiment" | "ralph"`.
- `packages/superintendent/src/commands/run.ts` defaults discovery to `.poe-code/superintendent`, while the superintendent skill says the canonical doc is `docs/plans/<name>.md`.
- Active `docs/plans/*.md` is already the human planning center, but only 2 active docs currently have frontmatter: one `superintendent` doc and one pipeline-style doc.
- `experiment` is the biggest drift point: README / skill examples show `status`, but `packages/experiment-loop/src/frontmatter/frontmatter.ts` ignores and drops that field on write.

Why this matters now:

- Moving all runnable planning docs into `docs/plans/` is already the direction implied by `poe-code plan` and superintendent.
- Once multiple runtimes share one directory, directory-based source detection stops being enough; we need `kind`.
- Without generated schemas, editor help, validation, and long-term compatibility will keep drifting.

Out of scope for the first consolidation pass:

- Redesigning the runtime semantics of every harness.
- Forcing all legacy docs to migrate in one pass.
- Unifying all runtime-state persistence immediately (for example experiment journals vs in-doc status mutation).
- Rewriting README files in this turn.

## 2. User-facing shape

### Target directory model

Project-local planning docs live in one place:

- `docs/plans/*.md`
- `docs/plans/archive/*.md`

New docs created by `poe-code plan`, `poe-code pipeline ...`, `poe-code experiment ...`, `poe-code ralph ...`, and `poe-code superintendent ...` should all default there.

### Target document identity

Every new typed planning doc starts with advisory schema metadata:

```yaml
---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/experiment.schema.json
kind: experiment
version: 1
...
---
```

Recommended canonical `kind` values:

- `plan` — generic five-altitude planning doc from `poe-code plan`
- `pipeline`
- `experiment`
- `ralph`
- `superintendent`
- `superintendent-base` (already emerging in the extends plan)

### `poe-code plan list`

`poe-code plan list` should become document-centric. It should show at least:

- file name / path
- `kind`
- friendly type label
- runtime/detail summary
- updated date

Example:

```text
Kind           Type             Name                               Detail
plan           Plan             memory.md                          design doc
pipeline       Pipeline         plan-utils-symlink-...md           3/8 done
experiment     Experiment       optimize-tests.md                  maximize · open
ralph          Ralph            refactor-auth.md                   claude-code · open
superintendent Superintendent  pi-mono-coding-agent-...md         review 12
```

Important UX change: once everything is in `docs/plans/`, `source` becomes an implementation detail. The user-facing concept should be **document kind / type**, not directory of origin.

### Project config

Use one shared plan-directory config as the source of truth:

```json
{
  "plan": {
    "plan_directory": "docs/plans"
  }
}
```

Per-harness `*_plan_directory` settings become deprecated aliases, not the primary model.

### Sticky path config

If we keep a "default current plan" config, it should live under the shared `plan` scope, not in a harness-specific side config.

Recommended canonical stored name if added:

- `plan.plan_path`

Not recommended as a required primitive for v1. It is useful as an optional convenience only.

- Open question: do we actually want one sticky active plan for the whole repo, or is directory discovery enough once all docs live in `docs/plans/`?

## 3. Implementation details and technical decisions

### A. Use `kind` as the discriminator, not path heuristics

Once the canonical directory is shared, discovery must parse docs and classify them by content.

Recommended rule set:

1. Parse frontmatter if present.
2. If `kind` exists, that is authoritative.
3. If no `kind` exists, fall back to legacy heuristics temporarily:
   - superintendent if current parser accepts it
   - pipeline if `tasks:` frontmatter exists
   - experiment if `metric` / `baseline` shape exists
   - ralph if `agent` / `iterations` / status shape matches
   - otherwise `plan` for plain `docs/plans/*.md`
4. Any writer for touched docs should emit canonical `kind` on rewrite.

This lets discovery migrate first without forcing a one-shot rewrite of old files.

### B. Generate schemas during build

Recommended ownership model:

- `@poe-code/pipeline` exports a pipeline document schema.
- `@poe-code/experiment-loop` exports an experiment document schema.
- `@poe-code/ralph` exports a Ralph document schema.
- `@poe-code/superintendent` exports a superintendent document schema.
- `poe-code` core exports the generic `plan` document schema.

Recommended build flow:

1. Code-first schema definitions live next to the owning parser.
2. `npm run build` (or a dedicated codegen step invoked by build) emits generated JSON Schema files into `docs/schemas/plans/`.
3. CI checks that generated artifacts are up to date.
4. GitHub Pages publishes `docs/schemas/**`.

Recommended output layout:

```text
docs/schemas/plans/
  plan.schema.json
  pipeline.schema.json
  experiment.schema.json
  ralph.schema.json
  superintendent.schema.json
  superintendent-base.schema.json
```

This matches the earlier direction already captured in the archived single-doc workflow planning and `docs/plans/poe-code-config-schema-generation.md`.

### C. Canonical casing should be snake_case in stored docs

If harness-specific config remains in frontmatter, the stored YAML should converge on snake_case.

Recommended canonical migrations:

- `maxExperiments` -> `max_experiments`
- `metricTimeout` -> `metric_timeout`
- `planPath` -> `plan_path`

Keep legacy aliases readable during migration, but always write the canonical snake_case form.

Why this is worth it:

- YAML/frontmatter already leans snake_case (`max_rounds`, `review_turn`).
- MCP and published schema surfaces in this repo already prefer snake_case.
- Mixed casing makes generated schemas and docs look sloppy.

### D. Promote `plan.plan_directory` and demote harness-specific directory config

Current config spread:

- `plan.plan_directory` already exists in `src/services/config.ts`.
- `pipeline.plan_directory`, `experiment.plan_directory`, `ralph.plan_directory`, and `superintendent.plan_directory` duplicate the same concept.
- `pipeline` also has a separate `.poe-code/pipeline/config.yaml` with `planPath`.

Recommended direction:

- Shared source of truth: `plan.plan_directory`
- Temporary aliases: per-harness `plan_directory` env/config settings
- Long-term removal: per-harness directory settings after migration

`pipeline` is the odd one out because it still has extra side-config. That should be reduced, not copied to the others.

### E. Separate three concepts that are currently mixed together

We should model these explicitly:

1. **Kind** — what the document is (`experiment`, `ralph`, etc.)
2. **Runner** — which command can execute it (`poe-code experiment run`, etc.)
3. **Location** — where the file lives (`docs/plans/...`)

Today location often implies runner. After consolidation, it cannot.

### F. Do not try to unify all runtime state in the first pass

Current state persistence differs:

- `pipeline` mutates task status in the document
- `ralph` mutates `status` in frontmatter
- `superintendent` mutates `status` + task board in the document
- `experiment` keeps authoritative progress in the journal sidecar, not the frontmatter

Recommendation: unify **metadata, discovery, schemas, and directory layout first**. Leave runtime-state persistence alone in v1.

- Open question: after metadata consolidation lands, do we want a second pass that moves all runtime state to sidecars, or keep mutable docs for human visibility?

### G. Superintendent should join the same registry as the others

`superintendent` is already closest to the desired end state:

- it has `kind`
- it already expects `docs/plans/<name>.md` in the skill
- it already treats the same file as both design doc and executable workflow doc

The main inconsistency is discovery defaulting to `.poe-code/superintendent` instead of the shared plan directory.

### H. Generic plan docs should become first-class, not invisible

`poe-code plan` writes plain markdown into `docs/plans`, but `poe-code plan list` does not list those docs today.

Recommendation:

- New generic plan docs should eventually emit `kind: plan` + `version: 1`
- Legacy plain markdown docs can be classified as `plan` heuristically
- `poe-code plan list` should show them, even if they are not runnable by a harness

This makes the command match user intuition: it lists plan documents, not just harness run files.

## 4. Interfaces and test plan

### Proposed normalized metadata shape

The discovery layer should return something closer to:

```ts
type PlanKind =
  | "plan"
  | "pipeline"
  | "experiment"
  | "ralph"
  | "superintendent"
  | "superintendent-base";

type PlanEntry = {
  path: string;
  absolutePath: string;
  kind: PlanKind;
  typeLabel: string;
  runner?: "pipeline" | "experiment" | "ralph" | "superintendent";
  title: string;
  detail: string;
  updatedAt: number;
  format: "markdown" | "yaml";
  schemaUrl?: string;
  legacy: boolean;
};
```

`runner` is optional because `kind: plan` and `kind: superintendent-base` are not directly runnable.

### Proposed schema export contract

Each owning package exports something like:

```ts
export const experimentDocumentSchema = ...;
export const experimentDocumentSchemaId = "https://.../experiment.schema.json";
```

The build step consumes those exports and writes JSON files.

### Test strategy

Unit tests:

- classify each doc kind correctly from frontmatter
- classify legacy docs without `kind`
- prefer explicit `kind` over heuristics
- list `superintendent` and generic `plan` docs in `poe-code plan list`
- render `kind` / type columns in terminal + JSON outputs
- respect `plan.plan_directory` first
- keep per-harness legacy directory aliases working during migration
- canonicalize stored field names to snake_case on write while accepting legacy aliases on read
- generate schemas deterministically into `docs/schemas/plans/`

Integration / smoke tests:

- `poe-code plan list` in a repo where `docs/plans/` contains mixed doc kinds
- `poe-code experiment run`, `ralph run`, `pipeline run`, and `superintendent run` against docs inside `docs/plans/`
- build step regenerates schemas and CI fails if they are stale

Manual QA:

- visual screenshot of `poe-code plan list`
- open representative docs in an editor and confirm schema URL + IntelliSense work
- verify archive behavior still lands under `docs/plans/archive/` where applicable

Migration coverage:

- old docs in `.poe-code/experiments`, `.poe-code/ralph/plans`, `.poe-code/pipeline/plans`, and `.poe-code/superintendent` continue to resolve during the compatibility window
- old docs without `kind` still list and run
- touched docs rewrite to canonical metadata

## 5. Code plan

### Files / areas to change

Core wiring:

- `src/services/config.ts`
  - make `plan.plan_directory` the canonical shared directory
  - decide whether to add `plan.plan_path`
  - deprecate per-harness directory scopes or keep them as aliases only
- `src/cli/commands/plan.ts`
  - list/view/filter by `kind`
  - include `superintendent` and generic plan docs
  - stop assuming `source` is the primary classification

Plan browser package:

- `packages/plan-browser/src/types.ts`
  - replace `PlanSource`-centric model with `PlanKind` + optional runner/source
- `packages/plan-browser/src/discovery.ts`
  - scan shared plan directory
  - classify by `kind` / heuristics
  - include superintendent + plain plan docs
- `packages/plan-browser/src/format.ts`
  - per-kind detail formatters
  - generic `plan` fallback detail
- `packages/plan-browser/README.md`
  - update config contract after implementation

Owning packages:

- `packages/pipeline/...`
  - export canonical pipeline doc schema
  - accept / write `kind: pipeline`
  - normalize `plan_path` if that concept remains
- `packages/experiment-loop/...`
  - export canonical experiment schema
  - add `kind: experiment`
  - normalize `max_experiments` / `metric_timeout`
  - decide how documented `status` should be handled explicitly
- `packages/ralph/...`
  - export canonical Ralph schema
  - add `kind: ralph`
- `packages/superintendent/...`
  - export canonical superintendent schemas
  - switch default discovery to shared plan directory

Build / release:

- add schema codegen script under `scripts/`
- emit generated artifacts to `docs/schemas/plans/`
- add CI freshness check
- add GitHub Pages publish workflow for schema artifacts

Templates / skills:

- `src/templates/plan/SKILL_plan.md`
  - eventually emit `kind: plan`
- `src/templates/experiment/SKILL_experiment.md`
  - move default output path to `docs/plans/<name>.md` once runtime is ready
  - emit canonical snake_case + `kind`
- pipeline / superintendent templates
  - align to shared location and canonical metadata

### Suggested build order

1. **Discovery first** — teach the plan browser / CLI to understand `kind` and include superintendent + generic plan docs.
2. **Config second** — make `plan.plan_directory` the canonical shared directory while keeping aliases.
3. **Schema exports third** — add per-package schema definitions and build-time codegen.
4. **Writers fourth** — make touched docs emit canonical `kind`, `version`, and snake_case fields.
5. **Template migration fifth** — update skills/templates to create docs in `docs/plans/` by default.
6. **Compatibility cleanup last** — remove old directory defaults only after mixed-repo testing proves safe.

### Recommended decisions

- **Yes:** move to one shared `docs/plans/` directory.
- **Yes:** require `kind` for all new runnable docs.
- **Yes:** generate and publish JSON Schemas.
- **Yes:** make `poe-code plan list` show `kind` / document type.
- **Yes:** canonicalize stored frontmatter field names to snake_case.
- **No for now:** do not make a global `plan.plan_path` mandatory.
- **No for now:** do not unify runtime-state persistence in the same pass.

### Extra optimizations worth considering after the main consolidation

- Move lock/journal/runtime sidecars out of `docs/plans/` into a hidden artifact directory so source docs stay clean.
- Centralize frontmatter parsing/writing helpers; today the repo uses multiple parser styles (`gray-matter`, manual fence parsing, YAML document parsing).
- Add `version: 1` consistently everywhere so future schema evolution has a clean path.
- Add `poe-code plan validate` as a cross-kind validator front-end.
- Add `--kind <kind>` filtering to `poe-code plan list` and `poe-code plan browse`.
- Make archive behavior consistent across all runners, including sidecar handling.
