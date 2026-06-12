import { describe, expect, it } from "vitest";
import { renderLandingPage } from "./render.js";

const page = {
  title: "toolcraft — tools for agents and humans",
  description: "Define a command once. Get a typed CLI, an MCP server, and a typed SDK.",
  name: "toolcraft",
  headline: "Define a command once.",
  headlineHighlight: "Run it everywhere.",
  tagline: "One definition becomes a typed CLI, an MCP server, and a typed SDK.",
  accent: "#a200ff",
  install: "npm install toolcraft",
  version: "0.0.4",
  repoUrl: "https://github.com/poe-platform/poe-code",
  useCases: [
    {
      title: "Consolidate scripts",
      description: "One tree from a folder of scripts.",
      example: "export const root = defineGroup({ children: [backup] });"
    },
    {
      title: "Give agents tools",
      description: "Safe commands as MCP tools.",
      example: 'defineGroup({ scope: ["cli", "mcp", "sdk"] })'
    }
  ],
  example: {
    source: "export const greet = defineCommand({ name: 'greet' });",
    surfaces: [
      { name: "CLI · runCLI", code: "mytool greet --name world" },
      { name: "SDK · createSDK", code: "await sdk.greet({ name: 'world' })" }
    ]
  },
  features: [
    { name: "Typed params", description: "One schema, every surface." },
    { name: "Declared secrets", description: "Env-backed, validated up front." }
  ],
  quickstart: "npm install toolcraft",
  includeJs: true
};

describe("renderLandingPage", () => {
  it("renders the accessible document structure", () => {
    const html = renderLandingPage(page);

    expect(html).toMatch(/<body>\s*<a class="skip-link" href="#example">Skip to example<\/a>/);
    expect(html).toContain("<header");
    expect(html).toContain('<nav class="nav" aria-label="Primary">');
    expect(html).toContain("<main>");
    expect(html).toContain('<section id="how-it-works" aria-labelledby="how-it-works-heading">');
    expect(html).toContain('<section id="use-cases" aria-labelledby="use-cases-heading">');
    expect(html).toContain('<section id="example" aria-labelledby="example-heading">');
    expect(html).toContain('<section id="features" aria-labelledby="features-heading">');
    expect(html).toContain('<section id="docs" aria-labelledby="docs-heading">');
    expect(html).toContain("</main>");
    expect(html).toContain("<footer");
    expect(html).toContain('aria-label="Copy npm install toolcraft"');
    // the install command is the only copyable snippet — example code for the
    // fictional tool must not grow copy buttons or shell prompts
    expect(html.match(/data-copy="/g)).toHaveLength(1);
    expect(html).not.toContain('id="surfaces"');
    expect(html).toContain(
      '<div class="visually-hidden" id="copy-status" role="status" aria-live="polite" aria-atomic="true"></div>'
    );
  });

  it("renders clear hero actions without filler", () => {
    const html = renderLandingPage(page);

    expect(html).toContain('<a class="button button-primary" href="#quickstart">Get started</a>');
    expect(html).toContain(
      '<a class="button button-secondary" href="https:&#x2F;&#x2F;github.com&#x2F;poe-platform&#x2F;poe-code">View on GitHub</a>'
    );
    expect(html).not.toContain('class="proof"');
    expect(html).not.toContain('class="surfaces-line"');
  });

  it("explains the mental model before task-oriented documentation", () => {
    const html = renderLandingPage(page);

    expect(html).toContain("Define the contract");
    expect(html).toContain("Expose the surfaces");
    expect(html).toContain("Govern the risky parts");
    expect(html).toContain("Start with one command");
    expect(html).toContain("Choose a runtime");
    expect(html).toContain("Add safety controls");
    expect(html).toContain("Migrate existing scripts");
    expect(html).toContain('href="docs/"');
  });

  it("renders the use cases as text-beside-code rows", () => {
    const html = renderLandingPage(page);

    expect(html).toContain('<div class="use-cases">');
    expect(html).toContain('<div class="use-case-text">');
    expect(html).toContain("<h3>Consolidate scripts</h3>");
    expect(html).toContain("Safe commands as MCP tools.");
    // each use case carries a syntax-highlighted snippet
    expect(html).toContain('<pre class="use-case-code">');
    expect(html).toContain('<span class="tok-kw">export</span>');
    expect(html).toContain("defineGroup({ children: [backup] });");
    expect(html).toContain('<span class="tok-str">&quot;mcp&quot;</span>');
  });

  it("renders the gradient headline highlight", () => {
    const html = renderLandingPage(page);

    expect(html).toContain(
      '<h1 class="title">Define a command once. <span class="title-accent">Run it everywhere.</span></h1>'
    );
    expect(html).toContain(".title-accent");
    expect(html).toContain("background-clip: text");
  });

  it("renders the worked example and feature cards", () => {
    const html = renderLandingPage(page);

    expect(html).toContain('<pre class="flow-source">');
    expect(html).toContain("defineCommand");
    // the worked-example source is syntax-highlighted (keywords wrapped)
    expect(html).toContain('<span class="tok-kw">const</span>');
    expect(html).toContain('<span class="flow-surface-name">CLI · runCLI</span>');
    expect(html).toContain('<div class="features">');
    expect(html).toContain("Typed params");
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
    expect(html).toContain("--accent: #9dc1ff;");
    expect(html).toContain("@media print");
    expect(html).toContain(".nav, .copy, .skip-link { display: none; }");
    expect(html).toContain(
      ".install code, pre { overflow: visible; white-space: pre-wrap; }"
    );
  });

  it("inlines narrow-screen navigation and overflow styles", () => {
    const html = renderLandingPage(page);

    expect(html).toContain("@media (max-width: 620px)");
    expect(html).toContain(".nav-links { width: 100%; gap: 8px; }");
    expect(html).toContain(".flow > * { min-width: 0; }");
    expect(html).toContain(".hero-actions { align-items: stretch; flex-direction: column; }");
  });
});
