# toolcraft-landing-page

Planned Toolcraft surface for generating a self-contained static HTML landing page from a command tree.

## Demo site

Build the package, then render the bundled `acme` example to `dist-site/index.html`:

```sh
npm run build -w toolcraft-landing-page
npm run build:site -w toolcraft-landing-page
```

The site build is deterministic, performs no network requests, requires no secrets, and also writes `dist-site/.nojekyll` for static hosting.

## Configuration

The package does not expose runtime configuration yet. The intended SDK and CLI options are tracked in `docs/plans/toolcraft-landing-page.md`.

## Environment variables

None.
