# Plan: Remove Handlebars Naming and Standardize on Mustache

## Summary

The repo already renders templates with **Mustache**, not Handlebars.

What remains is mostly:

- `.hbs` file extensions,
- loader names like `register-hbs-loader.mjs`,
- docs/comments that say "Handlebars".

So this is not primarily a library-removal project. It is a **naming + file-extension + wiring cleanup** so the codebase accurately reflects reality: Mustache is the template engine.

## Findings

### What we use today

- `mustache` is a direct dependency in the root package and several workspace packages.
- Template rendering in `packages/config-mutations` uses `Mustache.render(...)`.
- GitHub workflow prompt rendering uses `Mustache.render(...)`.
- There is **no Handlebars runtime dependency** in the repo.

### What still looks like Handlebars

- Template files in `src/templates/` use the `.hbs` extension.
- Dev/test tooling refers to an `hbs` loader:
  - `scripts/register-hbs-loader.mjs`
  - `scripts/hbs-loader.mjs`
- Type declarations expose `declare module "*.hbs"`.
- Some docs/comments still say "Handlebars templates".

### Template feature usage

The checked `.hbs` templates only use syntax that Mustache supports:

- normal variables like `{{body}}`,
- triple braces like `{{{profileName}}}`.

I did not find Handlebars-only features like:

- helpers,
- block helpers,
- partial inheritance,
- custom expressions.

So renaming away from Handlebars should be low risk.

## Goal

Make the repository consistently describe and use **Mustache** for templates.

## Non-goals

- No new templating features.
- No multi-pass rendering.
- No template-language expansion beyond current Mustache behavior.
- No README/doc changes in the planning step itself.

## Proposed migration

### 1. Rename template files away from `.hbs`

Pick one extension and use it consistently.

Recommended option:

- rename `.hbs` → `.mustache`

Examples:

- `src/templates/codex/config.toml.hbs` → `config.toml.mustache`
- `src/templates/experiment/run.yaml.hbs` → `run.yaml.mustache`
- `src/templates/pipeline/steps.yaml.hbs` → `steps.yaml.mustache`
- `src/templates/py-poe-spawn/env.hbs` → `env.mustache`

Why `.mustache`:

- explicit and accurate,
- matches the actual engine,
- avoids future confusion about Handlebars support.

Alternative if we want lower churn in tooling semantics:

- use a neutral extension like `.tmpl`

But `.mustache` is clearer.

### 2. Rename loader/tooling to neutral or Mustache-specific names

Rename:

- `scripts/register-hbs-loader.mjs` → `scripts/register-template-loader.mjs`
- `scripts/hbs-loader.mjs` → `scripts/template-loader.mjs`

Update:

- `package.json` dev script,
- `packages/plan-browser/src/browser.e2e.test.ts`,
- any comments that mention `.hbs` specifically.

The loader should support the new template extension plus `.md` and `.log` as needed.

### 3. Update type declarations

Change `src/types/assets.d.ts` to declare the new extension module, e.g.:

```ts
declare module "*.mustache" {
  const content: string;
  export default content;
}
```

Remove the `.hbs` declaration once all imports are migrated.

### 4. Update template import and lookup paths

Update every current `.hbs` reference, including:

- `src/providers/create-provider.ts`
- `src/providers/codex.ts`
- `src/cli/commands/experiment.ts`
- `src/cli/commands/pipeline.ts`
- tests importing template assets
- bundle/build config that loads text assets

Also update mutation `templateId` strings to use the new extension.

## Compatibility decision

### Option A — atomic rename (recommended)

Change all internal references in one PR.

Pros:

- simple end state,
- no long-term dual-extension maintenance,
- clearer code immediately.

Cons:

- larger single diff.

### Option B — temporary dual support

For one release, loaders and template lookup support both `.hbs` and `.mustache`.

Pros:

- safer if any hidden internal scripts depend on `.hbs`.

Cons:

- more branching and temporary complexity,
- violates the preference to keep things simple if not needed.

Recommended decision: **Option A**, unless we discover external consumers depend on raw template IDs/paths.

## Docs cleanup

When implementation is approved, update docs/comments that currently say "Handlebars" to "Mustache" or "template".

Known places include:

- `docs/ADDING_AGENT.md`
- `docs/README_FULL.md`
- inline comments in loader/template code

If we want to minimize churn, prefer wording like "template file" unless Mustache-specific behavior matters.

## Testing plan

Follow TDD for code changes.

### Unit / integration coverage

- update tests that import template assets to the new extension,
- add/adjust tests for template loading via the renamed loader,
- verify `config-mutations` template rendering behavior is unchanged,
- verify provider/template mutations still render expected files,
- verify experiment/pipeline install commands still load template text correctly.

### Validation commands

Minimum:

- `npm run test -- --runInBand` is not appropriate here; use existing Vitest flow instead
- `npm run test`
- `npm run lint`

Targeted checks likely sufficient during development:

- `vitest run src/cli/commands/pipeline-command.test.ts`
- `vitest run src/cli/commands/experiment-ralph.test.ts`
- `vitest run packages/config-mutations`

### Visual / adhoc validation

If any CLI text/install flow changes are visible, verify with screenshots per repo guidance, for example:

- `npm run screenshot-poe-code -- experiment install --help`
- `npm run screenshot-poe-code -- pipeline install --help`

## Implementation order

1. Add support for the new extension in loaders/tooling.
2. Rename template files.
3. Update imports, template IDs, and path references.
4. Update tests.
5. Remove old `.hbs` support.
6. Update docs/comments from "Handlebars" to "Mustache" if approved.

## Risks

- hidden path references to `.hbs` in tests or scripts,
- stale comments/docs after code migration,
- accidental introduction of dual-extension complexity if we over-engineer compatibility.

## Recommendation

Proceed with a focused cleanup PR that:

- keeps **Mustache** as-is,
- renames template assets from `.hbs` to `.mustache`,
- renames the loader away from `hbs`,
- updates docs/comments to stop mentioning Handlebars.

This gives us the simpler mental model you want without changing the actual rendering behavior.
