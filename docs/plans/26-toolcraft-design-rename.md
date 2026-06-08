---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1

tasks:
  - id: theme-singleton
    title: Add configurable brand theme as a global singleton
    prompt: |
      In packages/design-system (currently named @poe-code/design-system),
      make the brand palette a configurable global singleton while keeping
      today's output byte-identical by default.

      1. Add packages/design-system/src/tokens/brand.ts:
         export interface Brand { name: string; primary: string } // primary = hex
         export const brands: Record<string, Brand> = {
           purple: { name: "purple", primary: "#a200ff" },
           blue:   { name: "blue",   primary: "#2f6fed" },
           green:  { name: "green",  primary: "#1f9d57" },
         };
      2. Add packages/design-system/src/internal/theme-state.ts holding the
         singleton: configureTheme(patch: { brand?: string; label?: string }),
         getThemeConfig() (default { brand: "purple", label: "Poe" }), and
         resetTheme(). An unknown brand name must throw. configureTheme must
         invalidate the getTheme cache.
      3. Refactor packages/design-system/src/tokens/colors.ts to expose
         createPalette(brand: Brand, mode: "dark"|"light"): ThemePalette. The
         brand.primary drives header, intro background, resolvedSymbol, info,
         accent, prompt, and number; success(green)/warning(yellow)/error(red)/
         muted(dim) stay constant across brands. The intro entry must read the
         singleton label: ` ${label} - ${text} ` (today it is hardcoded
         " Poe - "). With brand=purple/label=Poe the produced palettes must
         equal the current dark/light constants exactly.
      4. Update packages/design-system/src/internal/theme-detect.ts getTheme()
         to resolve mode (existing light/dark detection unchanged) crossed with
         the active brand from theme-state, caching by (brand, mode). Keep
         resetThemeCache working (or have resetTheme cover it).
      5. Make packages/design-system/src/prompts/theme.ts brand-aware:
         promptTheme.style.accentColor must follow the active brand's primary
         (default purple #a200ff as today).
      6. Export configureTheme, getThemeConfig, resetTheme, brands, and Brand
         from packages/design-system/src/index.ts.

      TDD. Add unit tests: default config is purple/"Poe"; configureTheme
      merges and unknown brand throws; resetTheme restores defaults;
      createPalette(blue,"dark") and createPalette(green,"dark") emit the
      expected ANSI/hex while semantic colors are unchanged; intro embeds the
      configured label. Existing explorer/dashboard snapshots must stay green
      because the default brand is still purple. No call-site edits elsewhere.
    status:
      implement: done
      test: done
      commit: done

  - id: consolidate-theme-consumers
    title: Route explorer + dashboard through the active brand palette
    prompt: |
      Remove the duplicated brand/theme logic so a non-purple brand actually
      takes effect everywhere. All in packages/design-system.

      1. packages/design-system/src/explorer/theme.ts currently hardcodes brand
         colors (#a200ff / magenta / #006699 / cyan) AND carries its own copy of
         resolveThemeName. Delete the duplicate resolveThemeName (import the
         canonical one from ../internal/theme-detect.js) and source the
         brand-colored entries (accent, borderFocused, matchHighlight, the
         "info" tone) from the active brand palette instead of literals. Keep
         semantic tones (success/warning/error/muted) as-is.
      2. packages/design-system/src/dashboard/components/footer.ts,
         output-pane.ts, and stats-pane.ts hardcode #a200ff / magenta /
         #006699 for the brand accent. Replace those literals with the active
         brand color (read via the design-system theme, not inline hex).
      3. Do not change semantic colors and do not alter behavior for the
         default purple brand: existing explorer render snapshots and dashboard
         tests must remain green.

      TDD. Add focused assertions that switching the active brand (e.g. to
      "blue") changes only the brand-colored cells, leaving semantic cells
      untouched. Simplify duplicated helpers where the consolidation exposes
      them.
    status:
      implement: done
      refactor: done
      test: done
      commit: done

  - id: dep-cleanup
    title: Trim design-system dependencies and fix the undeclared test dep
    prompt: |
      Clean up packages/design-system dependency hygiene.

      1. Drop mustache + @types/mustache from packages/design-system/package.json.
         They are used ONLY as a test oracle in
         packages/design-system/src/components/template.test.ts (the runtime
         template.ts is self-contained). Rewrite those assertions to compare the
         renderer output against fixed expected strings so coverage is preserved
         without the dependency.
      2. terminal-pilot is imported by three test files but is not declared:
         add "terminal-pilot" to devDependencies (use the workspace version,
         "*"). In packages/design-system/src/terminal-markdown/terminal-markdown.test.ts
         fix the wrong specifier `@poe-code/terminal-pilot` to `terminal-pilot`
         (the real package name). The other two test files
         (explorer/runtime.test.ts, dashboard/dashboard.test.ts) already import
         "terminal-pilot" correctly.
      3. Keep @clack/prompts as the peerDependency.

      Run packages/design-system tests and the package-lint package to confirm
      no undeclared imports remain.
    status:
      implement: open
      test: open
      commit: open

  - id: rename-package
    title: Rename @poe-code/design-system to toolcraft-design (publish-ready)
    prompt: |
      Rename the package to the unscoped, publish-ready name `toolcraft-design`
      matching the toolcraft family. This is one atomic change; the repo must
      build and pass tests when done. Use codemod-style edits, not regex
      rewriting of files you have not parsed.

      1. git mv packages/design-system packages/toolcraft-design.
      2. packages/toolcraft-design/package.json: set "name": "toolcraft-design";
         remove "private": true; add an "exports" map (".": types+import to
         dist/index.js), "engines": { "node": ">=20" }, "repository" with
         "directory": "packages/toolcraft-design", and "publishConfig":
         { "access": "public" }. Fix any internal script paths that referenced
         the old directory.
      3. Replace ALL import specifiers "@poe-code/design-system" with
         "toolcraft-design" across the repo (≈118 .ts sites in src/, packages/**,
         tests/). Afterward `grep -r "@poe-code/design-system" --include=*.ts`
         must return zero hits outside docs/plans/archive.
      4. Update the dependency key "@poe-code/design-system" → "toolcraft-design"
         in every consumer package.json: package-lint, plan-browser, pipeline,
         toolcraft-openapi, agent-eval, agent-harness-tools, superintendent,
         ralph, e2e-test-runner, maestro-tui, markdown-reader, toolcraft,
         config-mutations, github-workflows, agent-spawn, config-extends.
      5. In packages/toolcraft/package.json and packages/toolcraft-openapi/package.json
         update the THREE references each: bundleDependencies,
         optionalDependencies, and the @poe-code/design-system argument in the
         prepack/postpack `manage-bundled-workspace-deps.mjs` invocations →
         toolcraft-design.
      6. Root package.json: rename the dependency key; update files[] entry
         "packages/design-system/dist" → "packages/toolcraft-design/dist";
         update scripts generate:design-docs (--filter), generate:design-docs:all
         (-w target), and demo:dashboard / demo:explorer paths.
      7. scripts/generate-docs.ts: update the ~35 codeSnippet template strings
         that embed `from "@poe-code/design-system"`. Update
         scripts/verify-toolcraft-standalone.mjs to the new bundled name.
      8. Run `npm install` to refresh workspace links / lockfile.

      Do not touch docs/plans/archive/** (historical). Then build all packages
      (turbo) and run the test suites of the renamed package plus the consumers
      to confirm everything is green.
    status:
      implement: open
      test: open
      commit: open

  - id: write-readme
    title: Add packages/toolcraft-design/README.md
    prompt: |
      Write packages/toolcraft-design/README.md (the package has none and
      CLAUDE.md requires one per package). Document: the package purpose and
      install/import as `toolcraft-design`; the public exports grouped as in
      src/index.ts (tokens, components, prompts, dashboard, explorer,
      terminal-markdown, static); the configurable brand theme API
      (configureTheme({ brand, label }), getThemeConfig, resetTheme, the built-in
      brands purple/blue/green, and how to register more); and ALL environment
      variables that affect rendering (POE_CODE_THEME, POE_THEME for light/dark,
      and POE_BRAND as a debug-only override that configureTheme takes
      precedence over). Keep it accurate to the actual exports — do not invent
      APIs.
    status:
      implement: open
      commit: open

  - id: wire-brands
    title: Wire blue for toolcraft, green for terminal-pilot, purple for poe-code
    prompt: |
      Configure the brand theme at each consumer's startup using
      toolcraft-design's configureTheme. The default is purple/"Poe", so
      poe-code already renders correctly; the others must opt in.

      1. toolcraft: at the toolcraft CLI entrypoint call
         configureTheme({ brand: "blue", label: "Toolcraft" }) before any
         design-system output. In toolcraft's code generation, emit a
         configureTheme({ brand: "blue", label: <generated tool name> }) bootstrap
         line in each generated CLI so generated tools render blue under their
         own name. Do this without per-brand if/switch branching — the brand is
         a plain string passed through.
      2. terminal-pilot: at its CLI entrypoint call
         configureTheme({ brand: "green", label: "Terminal Pilot" }).
      3. poe-code: at the poe-code CLI entrypoint call
         configureTheme({ brand: "purple", label: "Poe" }) explicitly (matches
         the default; explicit per project preference).

      TDD where there is logic (e.g. generated-bootstrap emission); for the
      entrypoint one-liners, add a test asserting the active brand after the
      entrypoint module configures it. Confirm poe-code output is unchanged
      (still purple) and toolcraft/terminal-pilot now resolve blue/green.
    status:
      implement: open
      test: open
      commit: open

  - id: regen-docs-and-screenshots
    title: Regenerate design docs and validate the three brands visually
    prompt: |
      Regenerate the generated design-language artifacts after the rename and
      brand work, then validate visually.

      1. Run `npm run generate:design-docs:all` to regenerate
         docs/DESIGN_LANGUAGE.md, docs/DESIGN_LANGUAGE_MARKDOWN.md,
         docs/DESIGN_LANGUAGE_JSON.md and the docs/design-language/*.png set,
         and confirm the embedded import snippets now read `toolcraft-design`.
      2. Capture screenshots with `npm run screenshot-poe-code` for: `poe-code
         --help` (must still be purple, unchanged), a representative `toolcraft`
         command (must be blue), and a representative `terminal-pilot` command
         (must be green). Inspect the screenshots to confirm the brand colors
         and intro labels render correctly and the layouts are intact.

      This task is docs/visual validation only — no new screenshot tests.
    status:
      implement: open
      commit: open
---

# Rename `@poe-code/design-system` → `toolcraft-design` + configurable brand theme

Rename the design-system package to the unscoped, publish-ready `toolcraft-design` (matching the `toolcraft` family), trim dependencies it doesn't need, and make the brand palette a configurable global singleton so `poe-code` stays purple, `toolcraft` (and the tools it generates) render blue, and `terminal-pilot` renders green. The `tasks:` frontmatter above is the executable Pipeline; the sections below are the design record.

## 1. What we're building

Three coordinated changes:

1. **Rename** `@poe-code/design-system` (scoped, `private`, leaf) to `toolcraft-design` (unscoped, publish-ready). Same public API surface; only the import specifier and package name change.
2. **Configurable brand theme** — a global singleton (`configureTheme`) that selects a brand palette and an intro label. Default `purple` / label `"Poe"` preserves today's `poe-code` output with zero edits to existing call sites. Brands are declarative data, so adding `green` for `terminal-pilot` is one registry entry, no branching.
3. **Dependency hygiene** — drop the `mustache` test-oracle, declare the undeclared `terminal-pilot` dev dependency, fix one wrong import specifier, and add the missing README.

### Non-goals

- No change to the exported component/function API names or signatures (the 118 import sites only swap the specifier string).
- Not publishing to npm yet. The package becomes structurally publish-ready (exports map, repository, engines, README) but stays out of the release pipeline; it continues to ship **bundled** inside `toolcraft`, `toolcraft-openapi`, and `poe-code` as it does today.
- Not dropping `@clack/prompts` — that's plan `24`. The peer dependency stays.
- Not touching archived plans under `docs/plans/archive/**` (historical references to the old name stay as written).

## 2. Current state (analysis)

`@poe-code/design-system` — v0.0.2, `private: true`, `main: dist/index.js`. It is a **leaf**: zero `@poe-code/*` runtime imports. Public surface is `packages/design-system/src/index.ts`.

### 2.1 Dependency audit

| Dependency                     | Kind today                    | Real usage                                                                                                        | Decision                                                         |
| ------------------------------ | ----------------------------- | ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| `@clack/prompts`               | peerDependency                | `prompts/` primitives                                                                                             | **Keep** (peer)                                                  |
| `mustache` + `@types/mustache` | devDependency                 | **test-oracle only** in `components/template.test.ts`; runtime `template.ts` is self-contained                    | **Drop** — replace oracle assertions with fixed expected strings |
| `terminal-pilot`               | **undeclared**                | imported in 3 test files (`terminal-markdown.test.ts`, `explorer/runtime.test.ts`, `dashboard/dashboard.test.ts`) | **Declare** as devDependency                                     |
| `@poe-code/terminal-pilot`     | **wrong specifier**           | `terminal-markdown.test.ts:5` (real package name is `terminal-pilot`)                                             | **Fix** specifier → `terminal-pilot`                             |
| `vitest`, `tsx`                | inherited from root workspace | tests / scripts                                                                                                   | leave inherited (dev-only)                                       |

Result: zero runtime deps beyond the `@clack/prompts` peer; two devDeps removed; one devDep added; one specifier fixed.

### 2.2 Blast radius of the rename

- **17 consumer `package.json`** declare `@poe-code/design-system`: `package-lint`, `plan-browser`, `pipeline`, `toolcraft-openapi`, `agent-eval`, `agent-harness-tools`, `superintendent`, `ralph`, `e2e-test-runner`, `maestro-tui`, `markdown-reader`, `toolcraft`, `config-mutations`, `github-workflows`, `agent-spawn`, `config-extends` (+ the package itself).
- **118 import sites** (`.ts`) across the repo: 57 in root `src/`, plus `toolcraft` (13), `agent-spawn` (8), `maestro-tui` (7), `superintendent`/`plan-browser`/`agent-eval` (6 each), `toolcraft-openapi` (3), and others.
- **Two publishable bundlers** reference it in three places each — `bundleDependencies`, `optionalDependencies`, and the `manage-bundled-workspace-deps.mjs` arg list in `prepack`/`postpack`: `packages/toolcraft/package.json` and `packages/toolcraft-openapi/package.json`.
- **Root `package.json`**: dependency `"@poe-code/design-system": "*"` (line 160); `files[]` entry `packages/design-system/dist` (line 103); scripts `generate:design-docs` (`--filter=@poe-code/design-system`, line 47), `generate:design-docs:all` (`-w @poe-code/design-system`, line 48), `demo:dashboard`/`demo:explorer` (paths, lines 77–78).
- **`scripts/generate-docs.ts`**: ~35 `codeSnippet` template strings embed `import … from "@poe-code/design-system"`.
- **`scripts/verify-toolcraft-standalone.mjs`** references the bundled name.
- No tsconfig path-mapping, vitest alias, or turbo reference keys on the package name (verified — nothing to change there beyond workspace globs).

### 2.3 Brand/theme state

The brand color is hardcoded in **four** places and the light/dark resolver is **duplicated**:

- `tokens/colors.ts` — `brand = "#a200ff"`; `dark`/`light` palettes use `magenta*`/`bgMagenta`/`#a200ff`; intro label `" Poe - "` is baked in.
- `prompts/theme.ts` — `accentColor: brand`.
- `dashboard/components/{footer,output-pane,stats-pane}.ts` — re-hardcode `#a200ff`/`magenta`.
- `explorer/theme.ts` — re-hardcodes brand colors **and** carries a second copy of `resolveThemeName` (the canonical one is `internal/theme-detect.ts`).

Semantic colors (success=green, warning=yellow, error=red, muted=dim) are brand-independent and stay constant.

## 3. Decisions

1. **New name:** `toolcraft-design`, unscoped, matching the `toolcraft`/`toolcraft-schema`/`toolcraft-openapi`/`toolcraft-codemode` family. Directory `packages/toolcraft-design`.
2. **Publish-ready, unpublished:** drop `private: true`; add `exports` map, `engines`, `repository`, `publishConfig` (`access: public`), README — but keep it out of the release set. It keeps shipping bundled in `toolcraft`/`toolcraft-openapi`/`poe-code`.
3. **Theme = global singleton** (modern design-system style). `configureTheme({ brand?, label? })` sets it once at startup; components read it via `getTheme()`. Default singleton = `{ brand: "purple", label: "Poe" }` ⇒ existing `poe-code` output is byte-identical, no call-site edits.
4. **Label is the running tool's name**, carried on the singleton. `poe-code` → `"Poe"`; `toolcraft` and each tool it generates set their own name; `terminal-pilot` → `"Terminal Pilot"`.
5. **Brands are declarative data** — a registry `{ name, primary }`. Built-ins and their starting primaries (tuned via screenshots in the final task):
   - `purple` — `#a200ff` (unchanged)
   - `blue` — `#2f6fed`
   - `green` — `#1f9d57`
     Adding a brand is one entry; no `if`/`switch` per brand anywhere.
6. **Consolidate**, don't duplicate: `explorer/theme.ts` and the dashboard components read the active brand palette; delete the duplicate `resolveThemeName` in `explorer/theme.ts`.
7. **Dependency cleanup** as in §2.1 (drop `mustache`, declare/fix `terminal-pilot`, add README).

## 4. Theme architecture

```ts
// tokens/brand.ts
export interface Brand {
  name: string;
  primary: string;
} // primary = hex
export const brands: Record<string, Brand> = {
  purple: { name: "purple", primary: "#a200ff" },
  blue: { name: "blue", primary: "#2f6fed" },
  green: { name: "green", primary: "#1f9d57" }
};

// internal/theme-state.ts  (the singleton)
export interface ThemeConfig {
  brand: string;
  label: string;
}
export function configureTheme(patch: Partial<ThemeConfig>): void; // merge into singleton
export function getThemeConfig(): ThemeConfig; // { brand:"purple", label:"Poe" } default
export function resetTheme(): void; // replaces resetThemeCache (tests)
```

- `tokens/colors.ts` exposes `createPalette(brand: Brand, mode: ThemeName): ThemePalette` — the brand `primary` drives `header`, `intro` background, `resolvedSymbol`, `info`, `accent`, `prompt`, `number`; semantic entries stay fixed. `intro` reads the singleton `label`: `` ` ${label} - ${text} ` ``.
- `getTheme(env?)` resolves `mode` (existing light/dark detection, unchanged) × active `brand` and caches by `(brand, mode)`; cache invalidated by `configureTheme`/`resetTheme`.
- `prompts/theme.ts`: `promptTheme` becomes brand-aware (reads active brand's `primary` for `accentColor`).
- `explorer/theme.ts` + `dashboard/components/*`: import the active palette instead of literals; remove the duplicate resolver.
- `POE_CODE_THEME`/`POE_THEME` continue to force light/dark. An optional `POE_BRAND` env override is **debug-only**; the explicit `configureTheme` call wins.

## 5. Test plan

TDD, all in-memory (`memfs` where files are touched), no network. New/updated tests:

- `internal/theme-state.test.ts` — default config is `purple`/`"Poe"`; `configureTheme` merges; `resetTheme` restores defaults; unknown brand name throws.
- `tokens/colors.test.ts` — `createPalette(blue, "dark")` and `createPalette(green, "dark")` emit the expected ANSI/hex; semantic colors identical across brands; `intro` embeds the configured label.
- `components/text.test.ts` — `intro` uses the active label and brand.
- `prompts/prompts.test.ts` — `promptTheme.style.accentColor` follows the active brand.
- `explorer/render/*` + `dashboard/*` snapshots — default brand `purple` keeps existing snapshots green (no churn); add focused assertions that switching brand changes the brand-colored cells only.
- `components/template.test.ts` — replace mustache-oracle comparisons with fixed expected strings (drops the dep without losing coverage).
- `terminal-markdown.test.ts` — import `terminal-pilot` (fixed specifier).

Rename is verified by the existing suites of all 17 consumers plus build/lint.

## 6. Task ↔ phase mapping

The executable tasks in the frontmatter are ordered so each leaves the repo green:

1. `theme-singleton` — brand registry + singleton + `createPalette`, default purple (behavior-preserving).
2. `consolidate-theme-consumers` — explorer + dashboard read the active palette; delete the duplicate resolver.
3. `dep-cleanup` — drop `mustache`, declare/fix `terminal-pilot`.
4. `rename-package` — atomic rename across dir, package name, 118 imports, 17 consumers, bundle lists, root, scripts; `npm install`.
5. `write-readme` — the required package README.
6. `wire-brands` — toolcraft + generated tools blue, terminal-pilot green, poe-code explicit purple.
7. `regen-docs-and-screenshots` — regenerate design docs + visually validate the three brands.

Final checks (e2e, smoke, commit) are handled by the pipeline `teardown`.

### Out of scope / parked

- Actually publishing `toolcraft-design` to npm (release pipeline + Trusted Publishers) — deferred until the standalone package is exercised.
- Dropping `@clack/prompts` (separate plan 24).
- Any edits to `docs/plans/archive/**`.
