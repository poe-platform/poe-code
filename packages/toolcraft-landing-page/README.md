# toolcraft-landing-page

Static HTML landing page renderer for Toolcraft.

The package exposes `renderLandingPage(page)`, which returns a self-contained
HTML document with inline CSS, optional copy-button JavaScript, highlighted code
examples, feature sections, quickstart content, and safe documentation/repository
links. It also includes a site build that renders the bundled Toolcraft example
to static files for hosting.

## Usage

```ts
import { renderLandingPage } from "./src/render.js";

const html = renderLandingPage({
  title: "Demo",
  description: "Demo page",
  name: "demo",
  headline: "Build once.",
  tagline: "Render a static page.",
  accent: "#3366ff",
  docsUrl: "https://example.com/docs",
  useCases: [],
  example: { source: "const tool = true;", surfaces: [] },
  features: [],
  quickstart: "npm install demo",
  includeJs: false
});
```

## Demo site

Build the package, then render the bundled toolcraft-family example to `dist-site/index.html`:

```sh
npm run build -w toolcraft-landing-page
npm run build:site -w toolcraft-landing-page
```

The site build is deterministic, performs no network requests, requires no secrets, and also writes `dist-site/.nojekyll` for static hosting.

Documentation links on the page point at the toolcraft package README on GitHub; the site does not generate a docs page.

## Configuration

`renderLandingPage(page)` accepts these fields:

| Option              | Type                                | Description                                                                 |
| ------------------- | ----------------------------------- | --------------------------------------------------------------------------- |
| `title`             | `string`                            | HTML document title.                                                        |
| `description`       | `string`                            | Meta description and page summary.                                          |
| `name`              | `string`                            | Product or package name.                                                    |
| `headline`          | `string`                            | Hero headline.                                                              |
| `headlineHighlight` | `string`                            | Optional highlighted headline segment.                                      |
| `tagline`           | `string`                            | Hero supporting copy.                                                       |
| `accent`            | `string`                            | CSS color name or hex color. Unsafe values fall back to the default accent. |
| `install`           | `string`                            | Optional install command shown in the hero.                                 |
| `version`           | `string`                            | Optional version label.                                                     |
| `repoUrl`           | `string`                            | Optional HTTP(S) repository link.                                           |
| `docsUrl`           | `string`                            | HTTP(S) documentation link used for README anchors.                         |
| `useCases`          | `{ title, description, example }[]` | Use-case rows with code examples.                                           |
| `example`           | `{ source, surfaces }`              | Main source example and generated surface examples.                         |
| `features`          | `{ name, description }[]`           | Feature cards.                                                              |
| `quickstart`        | `string`                            | Quickstart code block.                                                      |
| `includeJs`         | `boolean`                           | Include copy-button JavaScript when `true`.                                 |

## Environment Variables

The renderer does not read environment variables. The site build uses the bundled page definition and writes static files from package inputs only.
