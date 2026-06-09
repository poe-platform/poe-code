# toolcraft-landing-page

Static landing-page renderer for Toolcraft command surfaces. It turns a declarative
`LandingPageView` into a self-contained HTML page with inline CSS and optional inline
JavaScript.

## Rendering

```ts
import { renderLandingPage, type LandingPageView } from "./dist/render.js";

const page: LandingPageView = {
  title: "acme",
  description: "Acme command reference",
  name: "acme",
  headline: "Define once. Run everywhere.",
  tagline: "One command tree for every surface.",
  accent: "#7a00c2",
  surfaceCount: 3,
  commandCount: 2,
  groupCount: 1,
  surfaces: [],
  groups: [],
  quickstart: "npm install -g acme",
  includeJs: true
};

const html = renderLandingPage(page);
```

After `npm run build -w toolcraft-landing-page`, package-local scripts can import `./dist/render.js`. The renderer is deterministic and performs no network requests. The generated HTML includes
all page styles and, when `includeJs` is `true`, the built-in client-side behavior.

## Demo site

Build the package, then render the bundled `acme` example to `dist-site/index.html`:

```sh
npm run build -w toolcraft-landing-page
npm run build:site -w toolcraft-landing-page
```

The site build writes `dist-site/index.html` and `dist-site/.nojekyll` atomically so static
hosts never observe partial files.

## Configuration options

`renderLandingPage(page)` accepts a `LandingPageView` with:

- Page metadata: `title`, `description`, `name`, `headline`, `tagline`, `accent`, optional
  `install`, optional `version`, and optional `repoUrl`.
- Counts: `surfaceCount`, `commandCount`, and `groupCount`.
- `surfaces`: cards for CLI, MCP, SDK, or other exposed surfaces.
- `groups`: command groups with command descriptions, badges, params, secrets, and examples.
- `quickstart`: preformatted quickstart text.
- `includeJs`: whether to inline the bundled script.

The `buildSite({ outputDirectory?, fs? })` helper renders the bundled `acme` example. Omit
`outputDirectory` to write `dist-site` under this package.

## Environment variables

None.
