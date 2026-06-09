---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/pipeline.schema.json
kind: pipeline
version: 1
tasks:
  - id: a11y-aria-pass
    title: Make the generated landing page WCAG 2.1 AA accessible
    prompt: |
      In the toolcraft-landing-page package (src/template.ts, src/styles.ts,
      src/script.ts), make the generated HTML accessible to WCAG 2.1 AA.

      - Use semantic landmarks: <header>, <nav aria-label="Primary">, <main>,
        <section> tied to its heading via aria-labelledby, and <footer>.
      - Add a visually-hidden "Skip to commands" link as the first focusable
        element, targeting #commands; make it visible on focus.
      - Give each copy button an aria-label ("Copy <command>") and announce
        success through a single aria-live="polite" region, not only by
        swapping the button label.
      - Ensure every interactive element has a visible :focus-visible outline
        drawn in the accent color.
      - Verify contrast meets AA (>=4.5:1 body text, >=3:1 large text and UI
        borders) against both the light background and the accent; darken the
        --muted / --faint grays if they fail.
      - Respect prefers-reduced-motion by disabling smooth-scroll.

      Update examples/index.html to match. Extend the render tests to assert
      the landmarks, skip link, copy-button aria-labels, and the aria-live
      region are present in the output.
    status:
      implement: done
      test: done
      commit: done
  - id: design-dark-mode-responsive
    title: Add dark mode, responsive nav, and print styles
    prompt: |
      In the toolcraft-landing-page package (src/styles.ts, src/template.ts),
      polish the generated page. Keep everything inlined and framework-free.

      - Add a prefers-color-scheme: dark variant by overriding the color
        custom properties for dark (ink/bg/bg-soft/code-bg/line/muted darkened
        appropriately, accent kept legible against the dark background). No
        toggle UI; follow the OS setting.
      - Improve the layout below 620px: instead of hiding the nav links,
        collapse them into a wrapped, tappable row; ensure command cards,
        parameter tables, and code blocks scroll or stack cleanly on narrow
        screens.
      - Add an @media print stylesheet that removes the sticky nav, copy
        buttons, and decorative backgrounds for a clean printout.

      Update examples/index.html to match. Add render tests asserting the
      dark-mode and print media queries appear in the inlined CSS.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: build-demo-site
    title: Add a build:site script that renders the demo landing page
    prompt: >
      In the toolcraft-landing-page package, add a self-contained script at

      src/bin/build-site.ts plus an npm script

      "build:site": "node dist/bin/build-site.js".


      It renders the bundled example "acme" toolcraft tree to
      dist-site/index.html

      via renderLandingPage, with install/version/repoUrl set for the demo. It

      must be deterministic, require no secrets and no network, and also write

      dist-site/.nojekyll. Add dist-site/ to the package .gitignore.


      Add a test asserting the script produces a non-empty, self-contained HTML

      document (has <style>, no external <link>/<script src=>). Document the

      script in the package README.
    status:
      implement: done
      test: done
      commit: done
  - id: publish-demo-to-pages
    title: Publish the landing-page demo to GitHub Pages under a subpath
    prompt: >
      GitHub Pages serves a single deployment for this repo, already produced by

      .github/workflows/publish-schemas-pages.yml (it stages docs/schemas into

      "$RUNNER_TEMP/pages" and deploys via actions/deploy-pages, with a shared

      `pages` concurrency group).


      Do NOT add a second Pages-deploying workflow — a competing deploy would

      clobber the schemas site. Instead extend publish-schemas-pages.yml: after

      "npm run build", run the toolcraft-landing-page "build:site" script and

      copy its dist-site output into
      "$RUNNER_TEMP/pages/toolcraft-landing-page/"

      so the demo is served at

      https://poe-platform.github.io/poe-code/toolcraft-landing-page/. Leave the

      existing schemas staging untouched.


      Validate with `npm run lint:workflows`. Per repo policy, do not write unit

      tests for the workflow.
    status:
      implement: done
      commit: done
name: toolcraft-landing-page-pipeline
state: archived
---

# Context

Follow-on tasks for the `toolcraft-landing-page` package. The core generator
(SDK `renderLandingPage`, the `toolcraft-landing-page` bin, tree walk, template)
is specified in the five-level plan at
[toolcraft-landing-page.md](toolcraft-landing-page.md); the design reference is
the committed mock at
[examples/index.html](../../packages/toolcraft-landing-page/examples/index.html).
These tasks assume that core package exists.

## Design / accessibility (tasks 1–2)

- The page must stay a single self-contained `index.html`: inlined CSS and the
  small vanilla JS only — no framework, no animation library, no external assets.
- The accent stays configurable (default `#a200ff`); dark mode and contrast
  fixes must hold for any reasonable accent.
- Every visual change ships in both the generator (`src/styles.ts` /
  `src/template.ts`) and the `examples/index.html` reference so they stay in sync.

## GitHub Pages publishing (tasks 3–4)

- GitHub Pages allows exactly one deployment per repository. The demo is
  published as a **subpath of the existing Pages artifact**
  (`/toolcraft-landing-page/`), by extending `publish-schemas-pages.yml` — never
  by adding a second workflow that deploys Pages independently.
- The demo site is rendered from the bundled `acme` example tree, so publishing
  needs no secrets and is fully reproducible in CI.
- Workflow changes are validated with `npm run lint:workflows`; no unit tests
  are written for workflows.
