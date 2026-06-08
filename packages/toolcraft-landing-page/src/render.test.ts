import { describe, expect, it } from "vitest";
import { renderLandingPage } from "./render.js";

const page = {
  title: "acme",
  description: "Acme command reference",
  name: "acme",
  headline: "Define once. Run everywhere.",
  tagline: "One command tree for every surface.",
  accent: "#7a00c2",
  install: "npm install -g acme",
  version: "1.4.0",
  repoUrl: "https://github.com/acme/acme",
  surfaceCount: 1,
  commandCount: 1,
  groupCount: 1,
  surfaces: [{ name: "CLI", description: "Terminal commands.", example: "acme deploy" }],
  groups: [
    {
      name: "deploy",
      description: "Ship applications.",
      commands: [
        {
          pathPrefix: "acme deploy ",
          name: "prod",
          description: "Deploy to production.",
          badges: ["cli"],
          params: [],
          secrets: [],
          example: "acme deploy prod api"
        }
      ]
    }
  ],
  quickstart: "npm install -g acme\nacme deploy prod api",
  includeJs: true
};

describe("renderLandingPage", () => {
  it("renders the accessible document structure", () => {
    const html = renderLandingPage(page);

    expect(html).toMatch(/<body>\s*<a class="skip-link" href="#commands">Skip to commands<\/a>/);
    expect(html).toContain("<header");
    expect(html).toContain('<nav class="nav" aria-label="Primary">');
    expect(html).toContain("<main>");
    expect(html).toContain('<section id="commands" aria-labelledby="commands-heading">');
    expect(html).toContain("</main>");
    expect(html).toContain("<footer");
    expect(html).toContain('aria-label="Copy npm install -g acme"');
    expect(html).toContain('aria-label="Copy acme deploy prod api"');
    expect(html).toContain(
      '<div class="visually-hidden" id="copy-status" role="status" aria-live="polite" aria-atomic="true"></div>'
    );
  });

  it("renders accessible focus, contrast, and motion styles", () => {
    const html = renderLandingPage(page);

    expect(html).toContain("--muted: #555560;");
    expect(html).toContain("--faint: #666671;");
    expect(html).toContain("--line: #8a8a94;");
    expect(html).toContain(":is(a, button):focus-visible");
    expect(html).toContain("outline: 3px solid var(--accent)");
    expect(html).toContain(".skip-link:focus-visible { transform: translateY(0); }");
    expect(html).toContain("@media (prefers-reduced-motion: reduce)");
    expect(html).toContain("html { scroll-behavior: auto; }");
  });

  it("inlines dark-mode and print styles", () => {
    const html = renderLandingPage(page);

    expect(html).toContain("@media (prefers-color-scheme: dark)");
    expect(html).toContain("--bg: #111113;");
    expect(html).toContain("--accent: #d8a7ff;");
    expect(html).toContain("@media print");
    expect(html).toContain(".nav, .copy, .skip-link { display: none; }");
    expect(html).toContain(
      ".install code, .params-scroll, pre, .example pre, .quickstart pre { overflow: visible; white-space: pre-wrap; }"
    );
    expect(html).toContain(".params { min-width: 0; table-layout: fixed; }");
  });

  it("inlines narrow-screen navigation and overflow styles", () => {
    const html = renderLandingPage(page);

    expect(html).toContain("@media (max-width: 620px)");
    expect(html).toContain(".nav-links { width: 100%; gap: 8px; }");
    expect(html).toContain(".params-scroll { max-width: 100%; overflow-x: auto;");
    expect(html).toContain("-webkit-overflow-scrolling: touch;");
  });
});
