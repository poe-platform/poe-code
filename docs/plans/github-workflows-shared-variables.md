# Shared Prompt Variables for GitHub Workflows

## Problem

Every automation prompt repeats common instructions (e.g. "use `gh` CLI", "follow PR guidelines", "commit conventions"). There's no way to define reusable snippets that get injected across all prompts.

## Design

### `variables.yaml` — shared prompt snippets

A new file defines named text blocks that can be referenced from any automation prompt via `{{ variable_name }}`.

**Built-in** (ships with the package):
`packages/github-workflows/src/variables.yaml`

```yaml
# Preview rendered prompt: poe-code github-workflows prompt-preview <name>

response_style: |
  - Start with a direct answer or decision.
  - Keep it concise.
  - Use short Markdown sections only when they improve clarity.

verify_before_responding: |
  Before answering:
  - Inspect the checked-out repository.
  - Verify every claim against the repo before you post it.

skill_github_cli: |
  Use the `gh` CLI for all GitHub operations (issues, PRs, reviews, checks).
  Prefer `gh api` for data queries and `gh pr`/`gh issue` for mutations.

pull_request_guidelines: |
  - PR title: short, imperative, under 70 chars.
  - One logical change per PR.
  - Include a test plan in the PR body.
  - Request review from CODEOWNERS.
```

**Project-level override** (created by install):
`.poe-code/github-workflows/variables.yaml`

```yaml
# Preview rendered prompt: poe-code github-workflows prompt-preview <name>
#
# Built-in defaults are shown below as comments.
# To override a variable, uncomment it and replace the value.
# To disable a variable, uncomment it and set it to empty string: ""
# Variables left commented out keep the built-in default.

# response_style: |
#   - Start with a direct answer or decision.
#   - Keep it concise.
#   - Use short Markdown sections only when they improve clarity.

# verify_before_responding: |
#   Before answering:
#   - Inspect the checked-out repository.
#   - Verify every claim against the repo before you post it.

# skill_github_cli: |
#   Use the `gh` CLI for all GitHub operations (issues, PRs, reviews, checks).
#   Prefer `gh api` for data queries and `gh pr`/`gh issue` for mutations.

# pull_request_guidelines: |
#   - PR title: short, imperative, under 70 chars.
#   - One logical change per PR.
#   - Include a test plan in the PR body.
#   - Request review from CODEOWNERS.
```

### Usage in prompts

Any `.md` prompt can reference variables alongside the existing context variables:

```markdown
---
label: "GitHub: Issue Handler"
---
Read {{url}} and leave a visible GitHub response.

- If the issue needs code changes, implement them, open or update a PR, and comment with the result.
- If the issue is a question or needs only guidance, post a concise comment that directly answers it. Be practical, give examples.
- If you cannot complete the request, comment with the blocker and the next concrete step.

{{response_style}}

{{verify_before_responding}}
```

### Refactored built-in prompts

Extract the duplicated blocks from `github-issue-opened.md` and `github-issue-comment-created.md` into variables:

| Variable | Currently duplicated in |
| --- | --- |
| `response_style` | `github-issue-opened`, `github-issue-comment-created` |
| `verify_before_responding` | `github-issue-opened`, `github-issue-comment-created` |

The PR prompts (`github-pull-request-opened`, `github-pull-request-synchronized`) are intentionally terse — no variables needed there yet. Users can add `{{response_style}}` to ejected prompts if they want.

### Resolution order

1. Load built-in `variables.yaml` → all defaults
2. Load project `.poe-code/github-workflows/variables.yaml` (if exists)
3. Merge:
   - Key commented out (absent from parsed YAML) → built-in default used
   - Key present with value → override (project value wins)
   - Key present with `""` → variable removed (empty string, Mustache renders nothing)
4. Merge resolved variables into the template context before Mustache render

### `install` behavior

`poe-code github-workflows install <name>` (both caller and ejected) will also:

1. Create `.poe-code/github-workflows/variables.yaml` if it doesn't exist
2. Populate it with all built-in defaults shown as comments (so users can see what's available and uncomment to override)
3. Add the preview comment at the top

If the file already exists, smart-merge:
- **Uncommented keys** (user overrides) → preserve exactly as-is
- **Commented-out keys** → replace with latest built-in defaults (so users see up-to-date values)
- **New built-in keys** not in the file → append as commented-out
- **Commented keys removed from built-in** → drop them

This way, `install` (or re-install) keeps user customizations intact while refreshing the "menu" of available defaults.

#### Smart-merge approach

The project already uses `yaml@2.8.3` (`parseDocument()`) which preserves comments in the AST. `packages/pipeline/src/plan/writer.ts` already does comment-preserving round-trips.

Algorithm:

1. `parseDocument()` on the existing project file → get uncommented keys (user overrides)
2. Read the raw text to extract user override blocks (key + value as raw text)
3. Generate a fresh file from built-in defaults (all commented out)
4. For each user override: uncomment that key's block and replace the value with the user's value
5. Write the result

This avoids trying to surgically edit comments in the AST. Instead: regenerate the commented defaults, then re-apply user overrides on top. Simpler and always produces a clean file.

### `install` without arguments

`poe-code github-workflows install` (no name) installs **all** automations at once. Useful for first-time setup.

- Iterates `installableAutomations`, runs the install logic for each
- Creates `variables.yaml` and `README.md` once (not per automation)
- Shows a summary of all installed workflows

### README generation

`install` also creates `.poe-code/github-workflows/README.md` (overwritten on each install — no user content expected here).

Brief, command-focused. Example:

```markdown
# GitHub Workflows

## Commands

| Command | Description |
|---------|-------------|
| `poe-code github-workflows list` | List available automations |
| `poe-code github-workflows install <name>` | Install a workflow (use `--eject` to customize the prompt) |
| `poe-code github-workflows uninstall <name>` | Remove an installed workflow |
| `poe-code github-workflows prompt-preview <name>` | Preview the rendered prompt with variables resolved |
| `poe-code github-workflows run <name>` | Run an automation locally |

## Customization

Edit `variables.yaml` to override shared prompt variables.
Uncomment a variable and change its value. Set to `""` to disable.
```

### `variables` command

`poe-code github-workflows variables` — lists all variables with their resolution status.

```
Name                      Status      Source
response_style            default     built-in
verify_before_responding  overridden  .poe-code/github-workflows/variables.yaml
skill_github_cli          disabled    .poe-code/github-workflows/variables.yaml
pull_request_guidelines   default     built-in
custom_project_rules      custom      .poe-code/github-workflows/variables.yaml
```

Statuses:

- **default** — using built-in value (key commented out or no project file)
- **overridden** — project file has a custom value
- **disabled** — project file set to `""`
- **custom** — key exists only in project file (not a built-in)

### Changes to `prompt-preview`

`prompt-preview` already renders the prompt with Mustache. The only change: merge resolved variables into the template context so they render in the preview too.

This means the comment at the top of `variables.yaml` (`# Preview rendered prompt: poe-code github-workflows prompt-preview <name>`) is already actionable — no new command needed.

## Implementation

### Package: `packages/github-workflows`

#### 1. Add built-in `variables.yaml`

Create `packages/github-workflows/src/variables.yaml` with the default shared snippets.

#### 2. Variable loader (`variables.ts`)

New module:

```
loadVariables(builtInDir, projectDir?) → Record<string, string>
```

- Parse built-in `variables.yaml` (YAML, flat string keys)
- Parse project `variables.yaml` (if exists, only uncommented keys)
- Merge: built-in defaults as base, project overrides on top
- Empty string `""` means "disable this variable"
- Return merged map

Use the existing YAML parser already used elsewhere in the project.

#### 3. Wire into `buildTemplateContext`

In `commands.ts`, after building the env-based context, spread the resolved variables into it:

```typescript
const variables = await loadVariables(builtInDir, projectDir);
const sharedTemplateContext = { ...variables, ...buildTemplateContext(env) };
```

Variables are lower priority than env-derived context (issue, pr, comment, repo, url) — env wins on name collision.

#### 4. Wire into `install`

After writing the workflow file (and optionally the prompt), also ensure `.poe-code/github-workflows/variables.yaml` exists with built-in defaults shown as comments.

#### 5. Tests

- `variables.test.ts` — unit tests for `loadVariables`:
  - built-in only (no project file) → returns all defaults
  - project file with everything commented out → returns all built-in defaults
  - project overrides one key → that key uses project value, rest use built-in
  - project sets key to `""` → that variable excluded
  - project adds a new key not in built-in → included (extensible)
- Update `commands.test.ts`:
  - `prompt-preview` resolves shared variables
  - `install` creates `variables.yaml`
  - `run` injects variables into prompt

#### 6. Bundling

Ensure `variables.yaml` is included in the build output alongside prompts and workflow templates.

- Check `tsconfig.json` / `tsup.config.ts` / `package.json` in `packages/github-workflows` for how static assets (`.yaml`, `.md`) are copied to `dist/`
- The built-in `variables.yaml` must be resolvable at runtime from `dist/` the same way prompts are (via `import.meta.url` candidates pattern already used for `builtInPromptsDirCandidates`)
- The README template used by `install` must also be bundled or inlined in the source

**Verification step**: after implementation, build the package and confirm:
- `dist/variables.yaml` exists (or equivalent path)
- `dist/prompts/*.md` still present
- `dist/workflow-templates/*.yml` still present

### File inventory

| Action | File |
|--------|------|
| Create | `packages/github-workflows/src/variables.yaml` |
| Create | `packages/github-workflows/src/variables.ts` |
| Create | `packages/github-workflows/src/variables.test.ts` |
| Modify | `packages/github-workflows/src/commands.ts` (wire loader, install-all, variables cmd) |
| Modify | `packages/github-workflows/src/commands.test.ts` (new test cases) |
| Modify | `packages/github-workflows/src/prompts/github-issue-opened.md` (use variables) |
| Modify | `packages/github-workflows/src/prompts/github-issue-comment-created.md` (use variables) |
| Modify | build config if needed (ensure `.yaml` assets are copied to `dist/`) |
