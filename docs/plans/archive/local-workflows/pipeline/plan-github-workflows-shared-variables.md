---
kind: pipeline
version: 1
vars:
  plan_doc: "{{file 'docs/plans/github-workflows-shared-variables.md'}}"
tasks:
  - id: variables-loader
    title: Create variables.ts loader and variables.yaml defaults
    prompt: >
      Read the plan document for full context:


      {{plan_doc}}


      Implement two files in packages/github-workflows/src/:


      1. variables.yaml — the built-in shared prompt snippets (response_style,
      verify_before_responding, skill_github_cli, pull_request_guidelines)

      2. variables.ts — the loader module


      loadVariables(builtInDir, projectDir?) → Record<string, string>


      - Parse built-in variables.yaml with yaml library (already a dependency)

      - Parse project .poe-code/github-workflows/variables.yaml if it exists (only uncommented keys)

      - Merge: built-in as base, project overrides on top

      - Empty string "" means variable is disabled (exclude from result)

      - Return merged map


      Also implement the smart-merge function for generating/updating the project variables file:


      generateProjectVariablesFile(builtInVariables, existingProjectFileContent?) → string


      Algorithm:

      - If no existing file: generate all variables as commented-out YAML with the header comment

      - If existing file: parseDocument() to get uncommented keys (user overrides), regenerate the
      file with latest commented defaults, re-apply user overrides as uncommented
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: refactor-prompts
    title: Refactor built-in prompts to use shared variables
    prompt: >
      Read the plan document for context:


      {{plan_doc}}


      Modify two prompt files in packages/github-workflows/src/prompts/:


      1. github-issue-opened.md — replace the inline "Start with a direct answer..." and "Before
      answering..." blocks with {{response_style}} and {{verify_before_responding}}

      2. github-issue-comment-created.md — same replacements


      The prompt body should still make sense when read with the variables expanded. Keep all other
      content (frontmatter, issue/PR-specific instructions) unchanged.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: wire-into-commands
    title: Wire variables into commands (context, install, prompt-preview)
    prompt: >
      Read the plan document for context:


      {{plan_doc}}


      Modify packages/github-workflows/src/commands.ts:


      1. Import loadVariables from variables.ts

      2. In the run command handler: load variables and spread into sharedTemplateContext (lower
      priority than env context)

      3. In prompt-preview handler: same — merge variables into template context before Mustache
      render

      4. In install handler: after writing workflow file, call the smart-merge to create/update
      .poe-code/github-workflows/variables.yaml

      5. In install handler: generate .poe-code/github-workflows/README.md (overwrite each time)
      with the brief command reference from the plan

      6. Make install work without arguments — when no name is provided, install all automations.
      Create variables.yaml and README.md once, not per automation.


      Also add the new `variables` subcommand:

      - Lists all variables with status (default/overridden/disabled/custom) and source

      - Rich output: formatted table

      - JSON output: array of objects
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: bundling
    title: Ensure variables.yaml is bundled in dist
    prompt: >
      Read the plan document for context:


      {{plan_doc}}


      Ensure packages/github-workflows/src/variables.yaml is included in the build output.


      Check how prompts/ and workflow-templates/ are currently copied to dist/ (look at
      tsconfig.json, tsup.config.ts, package.json scripts).

      Apply the same mechanism to variables.yaml.


      After making changes, build the package and verify:

      - dist/variables.yaml exists

      - dist/prompts/*.md still present

      - dist/workflow-templates/*.yml still present
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# github workflows shared variables

Archived local pipeline plan converted from YAML during docs cleanup.
