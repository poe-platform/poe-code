---
kind: superintendent
version: 1

builder:
  agent: claude-code
  prompt: |
    Build the highest-priority open task from {{plan.path}}.

inspectors:
  code-quality:
    agent: claude-code
    prompt: |
      Make sure this code follows convention and good architecture. Outline any issues.

  developer-experience:
    agent: claude-code
    prompt: |
      Replay the builder's session with `npm run replay -- {{builder.log_path}}`
      and suggest developer-experience improvements. It's ok to pass if there's nothing significant.

  testing:
    agent: claude-code
    prompt: |
      Verify tests exist for the parser/writer/discovery changes and that the full
      `@poe-code/pipeline` test suite passes.

superintendent:
  agent: claude-code
  prompt: |
    Review the builder and inspector output, update the Task Board in {{plan.path}},

    Ask builder for rework based on feedback from inspectors.
    Request owner review when the board is complete and there's nothing left to do or add.

    Builder summary:
    {{builder.summary}}

    Inspector summaries:

    ## Code quality
    {{inspectors.code-quality}}

    ## Developer experience
    {{inspectors.developer-experience}}

    ## Testing
    {{inspectors.testing}}

owner:
  agent: claude-code
  prompt: |
    Decide whether the work is done. Approve or send back with feedback.

    Ask yourself question: Would a pipeline author discover the `.md` format naturally,
    and does every code path (parse, write, discover, skill, docs) agree on it?

    Superintendent summary:
    {{superintendent.summary}}

max_rounds: 100

status:
  state: in_progress
  round: 9
  review_turn: 0
---

# Pipeline Markdown Format

## Summary

Change pipeline plans from standalone YAML files to markdown files with YAML frontmatter, following the Ralph Wiggum pattern.

## Current Format

Separate files:

- Design doc: `docs/plans/e2e-sandbox-runner.md`
- Plan YAML: `.poe-code/pipeline/plans/plan-e2e-sandbox-runner.yaml` (references doc via `vars`)

## New Format

Single `.md` file with frontmatter containing all plan config:

```markdown
---
vars:
  plan_doc: "{{file 'docs/plans/e2e-sandbox-runner.md'}}"
tasks:
  - id: task-1
    title: Fix timeout
    prompt: Fix the timeout regression
    status: open
---

# Context

The design document body lives here as markdown...
```

Frontmatter holds: `tasks`, `vars`, `setup`, `teardown`, `mcp` (same fields as current YAML).
Body is the context document (design doc, notes, etc).

## Changes

### packages/pipeline

1. **parser.ts** - Extract frontmatter YAML, parse it, return `PipelinePlan` (same output type). Body is ignored by parser (it's context for the skill/agent, not the runner).
2. **writer.ts** - Split frontmatter from body, edit frontmatter YAML structurally, reassemble.
3. **discovery.ts** - Match `plan*.md` instead of `plan*.yaml`/`plan*.yml`.

### src/cli/commands/pipeline.ts

1. Update placeholder text from `.yaml` to `.md`.
2. Update validate command description.

### src/templates/pipeline/SKILL_plan.md

1. Update skill to output markdown with frontmatter instead of pure YAML.

### Init flow (future)

`pipeline init <doc.md>` runs agent with the plan skill, agent reads the doc and outputs a plan `.md` with frontmatter + body.

## Task Board

- [x] Update `packages/pipeline/src/plan/parser.ts` to extract YAML frontmatter from `.md` files and return `PipelinePlan` — verified via 112 passing tests in `packages/pipeline/src/pipeline.test.ts`, including new frontmatter and missing-delimiter cases
- [x] Update `packages/pipeline/src/plan/writer.ts` to split frontmatter from body, edit frontmatter structurally, and reassemble (preserve body verbatim) — verified via 113 passing tests in `packages/pipeline/src/pipeline.test.ts`, including new markdown-body preservation coverage
- [x] Update `packages/pipeline/src/plan/discovery.ts` to match `plan*.md` instead of `plan*.yaml`/`plan*.yml` — verified via 114 passing tests in `packages/pipeline/src/pipeline.test.ts`, including coverage that `.yaml`/`.yml` plans are ignored during discovery
- [x] Update `src/cli/commands/pipeline.ts` validate command `.description("Validate a pipeline plan YAML file without running it.")` (line 822) and argument `"Path to the pipeline plan YAML file"` (line 823) to refer to a markdown file — verified via 27 passing tests in `src/cli/commands/pipeline-command.test.ts`, including new help-output coverage, plus adhoc screenshot check with `npm run screenshot-poe-code -- pipeline validate --help`
- [x] Update `packages/pipeline/src/plan/discovery.ts` prompt placeholder `.poe-code/pipeline/plans/plan.yaml` (line 308) to `plan.md` — verified by targeted vitest rerun covering `packages/pipeline/src/pipeline.test.ts` and `src/cli/commands/pipeline-command.test.ts` after the prompt copy update
- [x] Update `src/templates/pipeline/SKILL_plan.md` to emit markdown with frontmatter (description, filenames, and output example now point to `.md` plans with YAML frontmatter + markdown body) — verified via 28 passing tests in `src/cli/commands/pipeline-command.test.ts`, including new template-content coverage for markdown/frontmatter instructions
- [x] Update `src/templates/pipeline/steps.yaml.mustache` line 9 comment "These can also be defined in plan.yaml…" to reference `plan.md` — verified by targeted vitest rerun covering `packages/pipeline/src/pipeline.test.ts` and `src/cli/commands/pipeline-command.test.ts` after the template comment update
- [x] Migrate the three active pipeline plan fixtures in `.poe-code/pipeline/plans/` from `.yaml` to `.md`: `plan-experiment-extends.yaml`, `plan-tui-e2e-test.yaml`, `plan-tui-e2e-verify.yaml`. Wrapped the existing YAML in `---` frontmatter delimiters, added short markdown context bodies (including the experiment design-doc link), deleted the legacy `.yaml` files, and verified with `npx vitest run packages/pipeline/src/pipeline.test.ts src/cli/commands/pipeline-command.test.ts`. Archive directory (`.poe-code/pipeline/plans/archive/`) and `docs/plans/archive/` remain out of scope.

## Superintendent Log

- Round 1: Builder produced no output; all three inspectors produced no output. Parser task was already completed in a prior state and verified now (tests green). Next highest-priority open task for the builder: `writer.ts` frontmatter-aware editing with accompanying tests.
- Round 2: Builder produced no output; all three inspectors produced no output. Parser and writer tasks verified complete (113 tests passing in `packages/pipeline/src/pipeline.test.ts`). Next highest-priority open task for the builder: update `packages/pipeline/src/plan/discovery.ts` to match `plan*.md` instead of `plan*.yaml`/`plan*.yml`, with discovery tests covering the new glob pattern.
- Round 3: Builder updated discovery to only surface `plan*.md` candidates, added regression coverage that legacy `.yaml`/`.yml` files are ignored, and verified `packages/pipeline/src/pipeline.test.ts` passes with 114 tests. Next highest-priority open task for the builder: update `src/cli/commands/pipeline.ts` placeholder text from `.yaml` to `.md`.
- Round 4: Builder produced no output; all three inspectors produced no output. Re-verified parser/writer/discovery work is intact (114 tests passing). While auditing remaining `.yaml` references in the source tree I found two more spots that belong with this rename and added them to the board: `packages/pipeline/src/plan/discovery.ts:308` placeholder and `src/templates/pipeline/steps.yaml.mustache:9` comment. Builder rework request: tackle the validate-command rename in `src/cli/commands/pipeline.ts` (line 822 `.description(…)` and line 823 argument help string), updating any `pipeline-command.test.ts` assertions that pin the old "YAML" wording in the same change.
- Round 5: Builder updated `pipeline validate` help text from YAML to markdown, added a regression test covering the validate subcommand help output, and refreshed default-discovery CLI fixtures in `pipeline-command.test.ts` from `plan.yaml` to `plan.md` so the full file passes again. Verified with 27 passing tests in `src/cli/commands/pipeline-command.test.ts` and an adhoc screenshot from `npm run screenshot-poe-code -- pipeline validate --help`.
- Round 6: Builder produced no output; all three inspectors produced no output. Re-verified parser/writer/discovery/CLI work is intact (114 tests passing in `packages/pipeline/src/pipeline.test.ts`). Builder rework request: update `src/templates/pipeline/SKILL_plan.md` to emit markdown plans with YAML frontmatter instead of pure YAML. Specifically: (1) change the description on line 3 from "Generate a Pipeline plan (YAML)…" to markdown wording; (2) replace the "Write a YAML pipeline plan" prose and the `plan-<name>.yaml` / `plan-<project>-<name>.yaml` filenames in step 2 with `.md` equivalents; (3) rework the "Output Format" block so the example shows a markdown file with a `---` frontmatter fence (tasks/vars/setup/teardown go inside the fence) followed by a body section the skill can use to paste in the context/design doc; (4) keep the existing rules (self-contained prompts, short kebab ids, stepless vs stepped status, inherited setup/teardown, vars-with-file-include semantics) intact — they all still apply inside the frontmatter. The owner's discoverability question (would a pipeline author naturally reach the `.md` format?) hinges on this skill matching the new format.
- Round 7: Builder produced no output; all three inspectors produced no output. Re-verified all completed tasks remain intact: SKILL_plan.md now describes markdown plans with YAML frontmatter (line 3 description, step 2 filenames, and Output Format example all reference `.md`); pipeline tests still green at 114 in `packages/pipeline/src/pipeline.test.ts`. Confirmed remaining text fixes are still untouched: `packages/pipeline/src/plan/discovery.ts:308` placeholder is still `.poe-code/pipeline/plans/plan.yaml`, and `src/templates/pipeline/steps.yaml.mustache:9` comment still says "in plan.yaml". Builder rework request: knock out both remaining text fixes in a single change — (1) edit `packages/pipeline/src/plan/discovery.ts` line 308 placeholder to `.poe-code/pipeline/plans/plan.md`, and (2) edit `src/templates/pipeline/steps.yaml.mustache` line 9 to read "These can also be defined in `plan.md`…". No new tests required for these prompt/comment string updates, but re-run `npx vitest run packages/pipeline/src/pipeline.test.ts src/cli/commands/pipeline-command.test.ts` to confirm no fixtures pin the old wording. After this, only the fixture/doc migration task will remain on the board.
- Round 8: Builder updated the remaining `.yaml` copy to `.md` in both the interactive plan-path placeholder (`packages/pipeline/src/plan/discovery.ts`) and the generated steps template comment (`src/templates/pipeline/steps.yaml.mustache`), then re-ran `npx vitest run packages/pipeline/src/pipeline.test.ts src/cli/commands/pipeline-command.test.ts` to confirm no fixtures still depend on the old wording. After this change, only the fixture/doc migration task remains open.
- Round 9: Builder produced no output; all three inspectors produced no output. Re-verified all completed tasks remain intact (114 passing tests in `packages/pipeline/src/pipeline.test.ts`; 28 passing tests in `src/cli/commands/pipeline-command.test.ts`). Confirmed the three active pipeline plan fixtures still use `.yaml` (`.poe-code/pipeline/plans/plan-experiment-extends.yaml`, `plan-tui-e2e-test.yaml`, `plan-tui-e2e-verify.yaml`); `docs/plans/` is already all markdown (yaml plans live only under `docs/plans/archive/`). Grep for these filenames across the tree returned no references, so migration is a self-contained rename. Builder rework request: for each of the three active fixtures, create a sibling `.md` file whose body is `---\n<existing YAML>\n---\n\n# Context\n\n<short note>` — for `plan-experiment-extends.yaml` point the body at `docs/plans/archive/experiment-extends.md` (or a one-line summary if the design doc is not present), and for the two tui-e2e fixtures write a one-sentence purpose line. Delete the `.yaml` files after the `.md` siblings are created. No test changes are required, but re-run `npx vitest run packages/pipeline/src/pipeline.test.ts src/cli/commands/pipeline-command.test.ts` after the migration to confirm discovery/parsing of the new `.md` fixtures still works end-to-end.
- Round 10: Builder migrated the three active fixture plans from `.yaml` to `.md` frontmatter files (`plan-experiment-extends.md`, `plan-tui-e2e-test.md`, `plan-tui-e2e-verify.md`), preserved each YAML payload inside `---` fences, added short markdown context bodies, deleted the legacy `.yaml` files, and re-ran `npx vitest run packages/pipeline/src/pipeline.test.ts src/cli/commands/pipeline-command.test.ts` successfully (142 tests passing).
- Round 11: Builder produced no output; all three inspectors produced no output. Re-verified end-state: `.poe-code/pipeline/plans/` contains only the three migrated `.md` fixtures (no stragglers); `packages/pipeline/src/plan/discovery.ts:308` placeholder reads `.poe-code/pipeline/plans/plan.md`; `src/templates/pipeline/steps.yaml.mustache:9` comment reads "These can also be defined in `plan.md`…". Every Task Board item is checked and substantiated by a verification artifact. Requesting owner review — the discoverability question (would a pipeline author naturally reach the `.md` format?) is now answered consistently across parser, writer, discovery, validate help, SKILL_plan, the steps template comment, and the migrated fixtures.
- Round 12: Builder produced no output; all three inspectors produced no output. End-state spot-checked again: `.poe-code/pipeline/plans/` lists only `archive/`, `plan-experiment-extends.md`, `plan-tui-e2e-test.md`, `plan-tui-e2e-verify.md`; `packages/pipeline/src/plan/discovery.ts:307` placeholder is `.poe-code/pipeline/plans/plan.md`; `src/templates/pipeline/steps.yaml.mustache:9` comment is "These can also be defined in `plan.md` to override the defaults below.". No outstanding items, no inspector concerns — re-requesting owner review without modification.
- Round 13: Builder produced no output; all three inspectors produced no output. End-state verified once more: `.poe-code/pipeline/plans/` contents unchanged (`archive/`, `plan-experiment-extends.md`, `plan-tui-e2e-test.md`, `plan-tui-e2e-verify.md`); discovery placeholder at `packages/pipeline/src/plan/discovery.ts:308` still reads `.poe-code/pipeline/plans/plan.md`; steps-template comment at `src/templates/pipeline/steps.yaml.mustache:9` still reads "These can also be defined in `plan.md` to override the defaults below.". Task Board is fully checked with verification artifacts on every item; nothing to add, nothing to rework. Re-requesting owner review.
