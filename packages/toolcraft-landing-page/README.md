# toolcraft-landing-page

Static landing-page renderer for Toolcraft command surfaces. It turns a declarative
`LandingPageView` into a self-contained HTML page with inline CSS, lightweight code
highlighting, and optional inline JavaScript.

## Rendering

```ts
import { renderLandingPage, type LandingPageView } from "./dist/render.js";

const page: LandingPageView = {
  title: "mytool",
  description: "One command tree for every surface",
  name: "mytool",
  headline: "Define once. Run everywhere.",
  tagline: "One handler becomes a CLI, MCP server, and SDK.",
  accent: "#7a00c2",
  install: "npm install -g mytool",
  surfaceCount: 3,
  useCaseCount: 2,
  surfaces: [],
  useCases: [],
  example: { source: "", surfaces: [] },
  features: [],
  quickstart: "npm install -g mytool",
  includeJs: true
};

const html = renderLandingPage(page);
```

After `npm run build -w toolcraft-landing-page`, package-local scripts can import
`./dist/render.js`. The renderer is deterministic, performs no network requests, and
escapes highlighted code before inlining it into the page. The generated HTML includes all page
styles and, when `includeJs` is `true`, the built-in client-side behavior.

## Demo site

Build the package, then render the bundled Toolcraft-family example to `dist-site/index.html`:

```sh
npm run build -w toolcraft-landing-page
npm run build:site -w toolcraft-landing-page
```

The site build writes `dist-site/index.html`, `dist-site/docs/index.html`, and
`dist-site/.nojekyll` atomically so static hosts never observe partial files. The guide content is
mirrored in `docs/index.md` for source review.

## Configuration options

`renderLandingPage(page)` accepts a `LandingPageView` with:

- Page metadata: `title`, `description`, `name`, `headline`, `tagline`, `accent`, optional
  `install`, optional `version`, and optional `repoUrl`.
- Counts: `surfaceCount` and `useCaseCount`.
- `surfaces`: cards for CLI, MCP, SDK, OpenAPI, or other exposed surfaces.
- `useCases`: task-oriented cards for the work the tool supports.
- `example`: one source snippet plus per-surface invocation examples.
- `features`: feature cards such as typed params, declared secrets, approvals, MCP proxying,
  dependency injection, and output rendering.
- `quickstart`: preformatted quickstart text.
- `includeJs`: whether to inline the bundled script.

The `buildSite({ outputDirectory?, fs? })` helper renders the bundled Toolcraft example. Omit
`outputDirectory` to write `dist-site` under this package.

## Environment variables

None.
