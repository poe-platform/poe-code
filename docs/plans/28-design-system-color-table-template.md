---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: ds-color-api
    title: Add ANSI color API to @poe-code/design-system
    prompt: |
      Add an internal ANSI color helper to @poe-code/design-system that
      replaces `chalk` for first-party callers.

      Create packages/design-system/src/components/color.ts exporting a
      `color` object with chainable styles. Required surface (derived from
      existing chalk usage in design-system + consumer packages — grep
      `from "chalk"` across packages/ before implementing to confirm):
        - foreground: red, green, yellow, blue, magenta, cyan, white,
          gray, black
        - bright variants only where currently used
        - modifiers: bold, dim, italic, underline, inverse, strikethrough
        - background: bgRed, bgGreen, bgYellow, bgBlue (only those used)
        - 256-color: `color.hex("#ff8800")` and `color.rgb(r,g,b)` —
          required by tokens/colors.ts and tokens/typography.ts
        - chainable: `color.red.bold("text")` and callable terminal.

      Honor color-detection: NO_COLOR=1 disables all codes, FORCE_COLOR
      forces on, otherwise detect via `process.stdout.isTTY` and
      `process.env.TERM`. Reuse the existing detection in
      packages/design-system/src/internal/theme-detect.ts if it covers
      this; otherwise add a small `internal/color-support.ts`.

      Export `color` and `type Color` from packages/design-system/src/index.ts.
      Do NOT remove `chalk` from peerDependencies in this task — only add
      the new API. Consumer migration is a separate task.

      Acceptance:
        - `color.red.bold("hi")` returns ANSI-wrapped string identical
          shape to chalk's (start codes + reset)
        - NO_COLOR=1 returns the raw string with zero ANSI bytes
        - Chains compose left-to-right and reset cleanly
    status:
      implement: done
      test: done
      refactor: done
      commit: done

  - id: ds-color-tests
    title: Unit + snapshot tests for design-system color API
    prompt: |
      Add packages/design-system/src/components/color.test.ts.

      Cover:
        - each foreground / background / modifier emits the expected
          ANSI escape sequence (compare against literal `\x1b[...m`
          strings — do not import chalk in tests)
        - chaining: `color.red.bold.underline("x")` wraps with all
          three codes and a single trailing reset `\x1b[0m`
        - `color.hex("#ff8800")("x")` emits the 24-bit truecolor
          sequence `\x1b[38;2;255;136;0m...\x1b[0m`
        - NO_COLOR=1 → strings round-trip unchanged
        - FORCE_COLOR=1 → strings always wrap even when isTTY is false
        - applying a chain to an already-colored string nests correctly
          and the outer reset doesn't strip the inner reset

      Use the project's vitest setup. Reset env vars between tests.
      Do not create files on disk (memfs rule does not apply here —
      no fs involved).
    status:
      implement: done
      test: done
      commit: done

  - id: ds-table-internal
    title: Replace console-table-printer with internal renderer
    prompt: |
      packages/design-system/src/components/table.ts currently imports
      `console-table-printer`. Rewrite `renderTable` to compute layout
      in-house and drop the dependency.

      Required behavior (preserve current public API — TableColumn and
      RenderTableOptions types stay unchanged; verify by reading the
      existing file and components/components.test.ts before editing):
        - per-column alignment (left | right | center)
        - per-column min/max width with truncation via ellipsis
        - color codes in cell values must not break width calculation
          (strip ANSI when measuring, keep when rendering)
        - header row separator and optional row separators
        - theme-aware border characters via existing tokens

      Use the new `color` API from task ds-color-api for any styling.
      Do NOT add new deps. Remove `console-table-printer` from
      packages/design-system/package.json peerDependencies in this task.

      Acceptance:
        - existing components.test.ts continues to pass
        - new snapshot tests cover: ANSI in cells, unicode width
          (e.g. emoji, CJK), truncation, alignment
    status:
      implement: done
      test: done
      refactor: done
      commit: done

  - id: ds-template-api
    title: Add mustache-compatible template renderer (no partials)
    prompt: |
      Add packages/design-system/src/components/template.ts exporting:
        renderTemplate(template: string, view: Record<string, unknown>,
          options?: {
            escape?: "html" | "none";
            yield?: string;
          }): string

      Goal: drop-in mustache replacement for every templating call site
      in the monorepo, including config-extends's [[yield]] composition.
      Implement the full mustache.js spec MINUS partials. Aim for parity
      that lets the parity test (see ds-template-tests) feed any
      reasonable template+view through both renderers and get matching
      output.

      Spec coverage required (mustache syntax uses double-curly; below
      `[[` `]]` stands in so this plan file parses):
        - [[name]] interpolation, HTML-escaped by default
        - [[{name}]] and [[&name]] unescaped interpolation
        - escape: "none" disables HTML escaping globally (matches what
          config-mutations and github-workflows do today by overriding
          Mustache.escape to identity)
        - [[#section]]...[[/section]] truthy gates, array iteration,
          object scope push
        - [[^section]]...[[/section]] inverted sections
        - [[!comment]] comments (stripped, including multiline)
        - dotted paths [[a.b.c]] and the implicit iterator [[.]]
        - section scope with parent lookup fallback (mustache's
          standard context-stack behavior)
        - lambdas: when a view value is a function, call it per the
          mustache.js spec (value section receives raw template,
          interpolation just returns the function's return value)
        - whitespace handling: standalone tags (a section/comment line
          with only whitespace) consume their surrounding newline,
          matching mustache.js
        - falsy rules: false, null, undefined, 0, "", [], {} as
          mustache.js treats them

      Explicitly NOT implemented:
        - partials ([[> name]])
        - custom delimiters ([[=<% %>=]])

      Yield support:
        - when `options.yield` is provided (string), substitute every
          occurrence of the literal token [[yield]] with that string
          BEFORE parsing the rest of the template. This matches the
          existing two-stage pipeline (config-extends resolves yield,
          then mustache renders) but folds it into one call.
        - when `options.yield` is omitted, [[yield]] behaves like any
          other variable reference — looked up in the view, rendered
          as "" if absent. The renderer enforces NO composition rules
          (e.g. "exactly one yield token") — those invariants live in
          config-extends and are not the renderer's concern.
        - yield substitution is literal, not mustache-rendered. If the
          yield value itself contains [[var]] tags, they ARE rendered
          in the subsequent mustache pass (because the substituted
          result is what the parser sees). This preserves today's
          semantics where a child body's mustache vars resolve against
          the parent view.
        - escape option does not affect yield substitution. The yield
          value is inserted raw.

      Export `renderTemplate` from packages/design-system/src/index.ts.

      Acceptance:
        - implementation lives in one file under ~450 LOC
        - parity tests (ds-template-tests) green
        - throws on unbalanced sections with a useful error message
        - never throws on undefined paths (renders as "")
        - yield value containing mustache tags is re-rendered against
          the view (covered by ds-template-tests)
    status:
      implement: done
      test: done
      refactor: done
      commit: done

  - id: ds-template-tests
    title: Mustache parity tests for design-system template
    prompt: |
      Add packages/design-system/src/components/template.test.ts.

      Test strategy: treat mustache.js as the oracle. The renderer is a
      drop-in replacement, so for any (template, view) pair the output
      must equal Mustache.render(template, view). Structure the file
      as two describe blocks:

      1. `unit` — hand-written fixtures for every feature listed in
         ds-template-api (interpolation, escaping, sections, inverted
         sections, comments, dotted paths, implicit iterator, lambdas,
         standalone-tag whitespace, falsy rules). Assert against
         hard-coded expected strings, NOT against mustache. These
         lock down behavior even after mustache is uninstalled.

      2. `parity` — imports `mustache` lazily; if the import throws
         (e.g. mustache uninstalled later), skip the whole block via
         `describe.skipIf`. For each fixture, assert
         renderTemplate(t, v) === Mustache.render(t, v). Include the
         actual templates extracted from current call sites — read
         these first and embed verbatim:
           - packages/github-workflows/src/commands.ts (every string
             passed to Mustache.render; collect via rg)
           - packages/config-mutations/src/execution/apply-mutation.ts
             (both call sites)
           - packages/config-mutations/src/template/render.ts
         Use representative view objects pulled from those files'
         tests so the comparison is realistic, not toy.

      3. `escape` — separately confirm that with escape: "none" the
         renderer matches the behavior of mustache when Mustache.escape
         is overridden to identity (the actual production setup).

      4. `yield` — cover the new yield option. In the spec sketches
         below, `[[...]]` stands in for double-curly so this plan file
         parses; the tests themselves use real mustache syntax:
           - renderTemplate("a [[yield]] b", {}, { yield: "X" }) →
             "a X b"
           - multiple yield tokens all substituted
           - yield value containing mustache tags gets re-rendered:
             renderTemplate("hi [[yield]]", { name: "K" },
                { yield: "[[name]]" }) → "hi K"
           - yield omitted → token resolves through view lookup (""
             if missing, value if present)
           - yield does NOT bypass section parsing: when wrapped in
             [[#section]]...[[yield]]...[[/section]] the yield
             substitution still happens before section processing
           - the renderer does NOT throw on >1 yield or unresolved
             yield (composition rules belong elsewhere)

      Add `mustache` and `@types/mustache` (if it exists) as
      devDependencies of @poe-code/design-system. Do NOT add them as
      runtime deps.
    status:
      implement: done
      test: done
      commit: done

  - id: migrate-chalk-design-system-internal
    title: Migrate design-system's own files off chalk
    prompt: |
      Replace `import chalk from "chalk"` with the new design-system
      `color` API in every file under packages/design-system/src/ that
      currently uses chalk. Confirm the list with:
        rg -l 'from "chalk"' packages/design-system/src

      Files at time of writing:
        - tokens/typography.ts
        - tokens/colors.ts
        - acp/components.ts
        - prompts/index.ts
        - prompts/primitives/{cancel,log,outro,spinner,note,intro}.ts
        - prompts/primitives/primitives.test.ts
        - static/menu.ts
        - static/static.test.ts
        - static/spinner.ts
        - components/{logger,symbols,text}.ts
        - components/components.test.ts
        - dashboard/dashboard.test.ts
        - dashboard/buffer.ts
      Scripts (scripts/demo.ts, scripts/generate-docs.ts) and the
      packages/design-system/layouts/*.ts files: also migrate.

      For each file, swap call shape `chalk.red.bold("x")` →
      `color.red.bold("x")`. Where chalk-specific features are used
      (hex/rgb/level), confirm `color` covers them. If a test compares
      against chalk literals, change the assertion to compare against
      literal ANSI strings instead.

      Drop `chalk` from packages/design-system/package.json
      peerDependencies. Run package tests and `npm run demo` to spot
      regressions.
    status:
      implement: done
      test: done
      commit: open

  - id: migrate-chalk-consumers
    title: Migrate remaining packages off direct chalk imports
    prompt: |
      Replace `chalk` with `color` from @poe-code/design-system in every
      remaining package. Confirm the list with:
        rg -l 'from "chalk"' packages/ -g '!packages/design-system/**'

      Files at time of writing:
        - packages/e2e-test-runner/src/preflight.ts

      Other packages list `chalk` in package.json but no longer import
      it directly: terminal-pilot-mcp, toolcraft-openapi, terminal-pilot,
      toolcraft. Confirm with rg, then remove `chalk` from each affected
      package.json's dependencies (NOT devDependencies — keep if used
      by build tooling, which is unlikely).

      For e2e-test-runner: add `@poe-code/design-system` to dependencies
      if not present (check package.json first). Replace the import and
      run that package's tests.

      Acceptance:
        - `rg 'from "chalk"' packages/` returns zero matches outside of
          generated dist/
        - `grep -l '"chalk"' packages/*/package.json` returns only
          packages where chalk is genuinely still needed (should be
          empty — verify and report if any remain)
        - all package test suites pass
    status:
      implement: open
      test: open
      commit: open

  - id: migrate-mustache-consumers
    title: Migrate mustache consumers to design-system template
    prompt: |
      Replace `Mustache.render` / `Mustache.escape` with
      `renderTemplate` from @poe-code/design-system across the
      following files:
        - packages/github-workflows/src/commands.ts
            (sets Mustache.escape to identity at module load — emulate
            with `renderTemplate(tpl, view, { escape: "none" })`)
        - packages/config-mutations/src/execution/apply-mutation.ts
            (two Mustache.render call sites — preserve their context
            objects unchanged)
        - packages/config-mutations/src/template/render.ts
            (wraps Mustache.render with a try/finally that swaps
            Mustache.escape — replace the whole helper with a thin
            wrapper around renderTemplate(..., { escape: "none" }))

      Update the JSDoc comments in
      packages/config-mutations/src/mutations/template-mutation.ts that
      reference "Mustache.render" to reference the new helper instead.

      Add `@poe-code/design-system` to each affected package's
      dependencies if missing. Remove `mustache` from each package's
      dependencies. Run each package's test suite.

      Verify with:
        rg -n 'Mustache|"mustache"' packages/
      The only remaining hits should be in design-system's parity test
      (devDependency) and in the existing commands.test.ts comment.

      Acceptance:
        - all three packages' existing test suites pass without
          modification (the renderer is drop-in)
        - github-workflows golden snapshots, if any, are unchanged
    status:
      implement: open
      test: open
      commit: open

  - id: migrate-config-extends-yield
    title: Replace config-extends yield substitution with renderTemplate
    prompt: |
      packages/config-extends/src/resolve.ts hand-rolls [[yield]] token
      handling via `String.replace`. Replace the literal substitution
      with `renderTemplate(prompt, {}, { yield: replacement,
      escape: "none" })` from @poe-code/design-system.

      Keep these composition rules in resolve.ts unchanged — they are
      prompt-composition invariants, not renderer concerns:
        - assertValidYieldCount (max 1 [[yield]] per prompt layer)
        - the final "unresolved yield" error
        - the multi-layer composeAdjacentPrompts flow

      Concretely:
        - the `replaceYield(high, low)` helper at line ~263 becomes a
          one-line call to renderTemplate
        - YIELD_TOKEN constant stays (used by countYieldTokens and the
          unresolved-yield check, which still inspect the raw string)
        - imports: add `renderTemplate` from @poe-code/design-system
        - add @poe-code/design-system to package.json dependencies if
          not present

      Run packages/config-extends/src/resolve.test.ts after migrating.
      All existing assertions must pass without changes — find the
      relevant tests by grepping `yield` in resolve.test.ts. The five
      that must keep passing cover: base wraps child body, child wraps
      inherited base, empty child body collapses to empty string,
      throws on more-than-one yield per layer, throws on unresolved
      yield in final output.

      This task makes renderTemplate the sole templating substrate in
      the monorepo.

    status:
      implement: open
      test: open
      commit: open

  - id: drop-dead-deps
    title: Drop chalk / console-table-printer / mustache from all package.json
    prompt: |
      Final sweep. For each of `chalk`, `console-table-printer`,
      `mustache`:
        1. `grep -l '"<name>"' packages/*/package.json` to enumerate
           remaining declarations
        2. for each match, confirm the dep is no longer imported in
           that package's src (rg should find no references)
        3. remove the dep entry from `dependencies`,
           `peerDependencies`, and `peerDependenciesMeta` as
           appropriate
      Do not modify devDependencies of @poe-code/design-system
      (mustache remains there for parity tests).

      Update the root package-lock.json by running `npm install` once
      from the repo root. Confirm no other dep changed by reviewing
      the lockfile diff.

      Acceptance:
        - `grep -rn '"chalk"\|"console-table-printer"\|"mustache"' \
            packages/*/package.json` matches only design-system's
          devDependencies (mustache) and nothing else
        - `npm run build` succeeds from the repo root
        - `npm run lint` succeeds from the repo root
    status:
      implement: open
      commit: open

  - id: visual-verify
    title: Screenshot + demo verification of CLI output
    prompt: |
      Per CLAUDE.md, visually verify any change that affects CLI output.
      Capture screenshots before/after for these commands and compare:

        npm run screenshot-poe-code -- --help
        npm run screenshot-poe-code -- configure --help
        npm run screenshot-poe-code -- list
        npm run screenshot-poe-code -- doctor

      Also run:
        npm run demo --workspace @poe-code/design-system
        npm run generate:design-docs

      The expected outcome is byte-identical or visually identical
      output to pre-change. Any drift in color, alignment, or table
      borders is a regression — fix the underlying API discrepancy
      rather than papering over it in the consumer.

      If the design-docs generator output diffs, regenerate and commit
      the docs along with the code.
    status:
      implement: open
      commit: open
---

## Context

### Goal

Remove three external deps in favor of small in-house equivalents inside
`@poe-code/design-system`:

- `chalk` (6 packages) → `color` API in design-system
- `console-table-printer` (5 packages, only design-system imports it) →
  internal table renderer
- `mustache` (5 packages, 3 real consumers) → `renderTemplate`,
  full mustache.js spec minus partials, plus a `yield` option that
  subsumes config-extends's literal token substitution

This consolidates styling/templating under design-system, enforces
CLAUDE.md's "no direct chalk / no @clack/prompts" rule by removing the
escape hatch, and shrinks the dep footprint.

### Why design-system

It already wraps `@clack/prompts` and declares `chalk` +
`console-table-printer` as peer deps. Adding ANSI color, table render,
and template render keeps the cohesive style boundary the rest of the
repo already imports from.

### Out of scope

- Other deps from the audit (smol-toml, fast-glob, semver, etc.)
- Replacing `@clack/prompts` (already wrapped, low ROI)
- Any API surface beyond what current callers use

### Testing approach

1. **Unit + snapshot per new primitive.** `color`, `renderTable`,
   `renderTemplate` each get a dedicated test file in
   packages/design-system/src/components/.
2. **Parity oracle for template.** Keep `mustache` as a devDependency
   of design-system only; parity tests compare renderTemplate output
   against `Mustache.render` for every feature we support. Block runs
   if mustache is unavailable (so the suite still passes after a
   future cleanup).
3. **ANSI-byte assertions, not chalk comparisons.** Tests assert
   against literal `\x1b[...m` sequences so they don't depend on
   chalk's internal representation.
4. **Unicode + ANSI width.** Table tests cover emoji, CJK, and cells
   that already contain ANSI codes — these are the common breakage
   points when rolling a table renderer.
5. **Consumer suites unchanged.** Each migration task runs the
   affected package's existing test suite without modifying tests
   (the new APIs are drop-in). If a test must change, that's a
   signal the new API drifted — fix the API, not the test.
6. **Visual verification.** A dedicated final task captures
   screenshots of CLI commands and runs the design-system demo +
   docs generator to catch regressions invisible to unit tests.

### Order dependencies

`ds-color-api` → `ds-color-tests` → `migrate-chalk-*`
`ds-table-internal` is independent of color but uses it for styling.
`ds-template-api` → `ds-template-tests` →
  `migrate-mustache-consumers` and `migrate-config-extends-yield`
  (independent, can run in either order)
`drop-dead-deps` runs after all migrations.
`visual-verify` runs last.

### Yield handling

Today `{{yield}}` is a literal pre-pass in
[packages/config-extends/src/resolve.ts:229](packages/config-extends/src/resolve.ts#L229),
then mustache renders the result. The new `renderTemplate` accepts an
optional `yield` string that does the same literal pre-pass internally,
so callers get a single-call API.

The renderer enforces **no** composition rules. The "exactly one yield
per layer" and "no unresolved yield in final output" invariants stay
in `config-extends/resolve.ts` because they apply across the multi-layer
extend chain, not to any single template render. Tests for those rules
in [resolve.test.ts](packages/config-extends/src/resolve.test.ts) must
continue to pass after the migration.
