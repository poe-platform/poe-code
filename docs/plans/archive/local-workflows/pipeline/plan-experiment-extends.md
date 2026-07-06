---
kind: pipeline
version: 1
vars:
  design_doc: "{{file 'docs/plans/archive/experiment-extends.md'}}"

tasks:
  - id: add-extends-type
    title: Add extends field to frontmatter type and parser
    prompt: |
      Add `extends` support to the experiment frontmatter type and parser.

      Design: {{design_doc}}

      ## Changes

      ### 1. `packages/experiment-loop/src/frontmatter/frontmatter.ts`

      Add `extends?: string` to `ExperimentFrontmatter` interface (line 5).

      In `parseFrontmatterData` (line 40), parse `extends` as an optional string using the existing `parseString` helper.
      Include it in the returned object like the other optional fields.

      In `serializeFrontmatter` (line 56), include `extends` in serialization so round-trips preserve it.

      ### 2. Tests in `packages/experiment-loop/src/experiment-loop.test.ts`

      Add tests to the frontmatter describe block:
      - Parse doc with `extends: review` — frontmatter.extends === "review"
      - Parse doc without extends — frontmatter.extends === undefined
      - Round-trip: parse then write preserves extends field
      - Extends field is a trimmed string, empty string becomes undefined

      Use memfs. Follow TDD — write the tests first, then make them pass.
    status:
      implement: open
      test: open
      commit: open

  - id: resolve-extends
    title: Implement extends resolver module
    prompt: |
      Create the extends resolver for experiment docs.

      Design: {{design_doc}}

      ## Create `packages/experiment-loop/src/config/extends.ts`

      Export a single function:

      ```typescript
      export async function resolveExtends(options: {
        frontmatter: ExperimentFrontmatter;
        body: string;
        cwd: string;
        homeDir: string;
        fs: Pick<ExperimentFileSystem, "readFile">;
      }): Promise<{ frontmatter: ExperimentFrontmatter; body: string }>
      ```

      ### Behavior

      1. If `frontmatter.extends` is undefined, return `{ frontmatter, body }` unchanged (passthrough).

      2. If `extends` is set, resolve the base template by name:
         - Search paths in order:
           a. `<cwd>/.poe-code/experiments/bases/<name>.md`
           b. `<homeDir>/.poe-code/experiments/bases/<name>.md`
         - Read the first file that exists using `fs.readFile`. If none found, throw:
           `Error: Base template "<name>" not found. Searched: <paths>`

      3. Parse the base file using `parseExperimentFrontmatter` from `../frontmatter/frontmatter.js`.

      4. If the base also has `extends`, recurse (the base's extends is resolved first).

      5. Depth limit: track depth, throw `Error: extends chain too deep (max 5)` at depth > 5.

      6. Merge: spread base frontmatter first, then child frontmatter on top (child wins).
         Strip `extends` from the final merged result (it's resolution metadata, not config).

      7. Body: if child body is non-empty (after trimming), use it. Otherwise inherit base body.

      ### Important details

      - Use `readFile` with try/catch for ENOENT to check existence (same pattern as `readOptionalFile` in `loader.ts`).
      - Import `parseExperimentFrontmatter` from the frontmatter module.
      - Import types from `../types.js`.

      ## Tests in `packages/experiment-loop/src/experiment-loop.test.ts`

      Add a new describe block `"extends resolver"` with these tests using memfs:

      1. **No extends — passthrough**: doc without `extends` returns unchanged frontmatter and body.
      2. **Simple extends**: child with `extends: base` and `agent: override-agent`. Base has agent, metric, body. Result has override agent, base metric, base body.
      3. **Body override**: child has non-empty body → child body wins over base body.
      4. **Body inherit**: child has empty body → base body is used.
      5. **Project path before global**: base exists in both project and global dirs. Project version is used.
      6. **Falls back to global**: base only in global dir. Global version is used.
      7. **Missing base throws**: `extends: nonexistent` throws with searched paths.
      8. **Chaining (A → B → C)**: A extends B, B extends C. All three contribute fields. A's overrides win over B, B over C.
      9. **Depth limit**: chain of 6 levels throws "extends chain too deep".
      10. **Extends stripped from result**: final frontmatter does not contain `extends` key.

      Use memfs `Volume.fromJSON` to set up the file trees. Follow TDD — write tests first.
    status:
      implement: open
      test: open
      commit: open

  - id: integrate-loop
    title: Integrate extends resolver into experiment loop
    prompt: |
      Wire the extends resolver into the experiment loop's doc reading.

      Design: {{design_doc}}

      ## Changes to `packages/experiment-loop/src/run/loop.ts`

      Import `resolveExtends` from `../config/extends.js`.

      In `runExperimentLoop` (line 227), modify the `readDoc` inner function (line 248) to call `resolveExtends` after parsing:

      ```typescript
      async function readDoc() {
        const rawContent = await fs.readFile(absoluteDocPath, "utf8");
        const parsed = parseExperimentFrontmatter(rawContent);
        return resolveExtends({
          frontmatter: parsed.frontmatter,
          body: parsed.body,
          cwd: options.cwd,
          homeDir: options.homeDir,
          fs,
        });
      }
      ```

      This is the only integration point — `resolveExtends` is a pure transformation that returns the same shape. Everything downstream (normalizeMetrics, normalizeAgents, buildPrompt) works unchanged.

      ## Tests in `packages/experiment-loop/src/experiment-loop.test.ts`

      Add integration tests in the existing loop describe block or a new `"loop with extends"` block:

      1. **Loop uses base template**: experiment doc with `extends: base`, base provides metric and body. Loop runs using the resolved metric and body.
      2. **Override agent via extends**: base has `agent: base-agent`, child has `agent: child-agent`. Loop spawns with child-agent.
      3. **Re-read picks up extends each iteration**: the loop re-reads the doc each iteration. Verify extends is resolved on each read (use the simulation harness with memfs, place base in the project bases dir).

      Use the existing simulation harness pattern from the test file. Place base templates in the memfs under `<cwd>/.poe-code/experiments/bases/`.
    status:
      implement: open
      test: open
      commit: open

  - id: export-and-docs
    title: Export resolveExtends and update README
    prompt: |
      Export the new module and update documentation.

      ## 1. Export from package index

      In `packages/experiment-loop/src/index.ts`, add:
      ```typescript
      export { resolveExtends } from "./config/extends.js";
      ```

      ## 2. Update `packages/experiment-loop/README.md`

      Add a section about `extends` support. Include:
      - What `extends` does (inherit frontmatter + body from a base template)
      - Where base templates are searched (project `.poe-code/experiments/bases/` → global `~/.poe-code/experiments/bases/`)
      - Merge semantics (child wins for all fields, body inherits if child is empty)
      - Chaining support (max depth 5)
      - Example:

      ```yaml
      # .poe-code/experiments/bases/review.md
      ---
      agent: claude-code
      metric:
        name: lint-score
        script: npm run lint:score
        direction: maximize
      ---
      Review code for quality...
      ```

      ```yaml
      # .poe-code/experiments/my-review.md
      ---
      extends: review
      agent: aider:openrouter/deepseek-v3
      ---
      ```

      ## 3. Update the experiment skill template

      In `src/templates/experiment/SKILL_experiment.md`, add a brief mention of `extends` in the frontmatter format section so users know it's available when creating new experiment docs.

      ## 4. Verify

      Run `npm run build` to confirm the export compiles.
      Run the full test suite for the package.
    status:
      implement: open
      test: open
      commit: open
---

# Context

Tracks the experiment `extends` work. Related design doc: `docs/plans/archive/experiment-extends.md`.
