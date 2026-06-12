export const TEMPLATE = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="{{description}}">
    <title>{{title}}</title>
    <style>{{{styles}}}</style>
  </head>
  <body>
    <a class="skip-link" href="#example">Skip to example</a>
    <header>
      <nav class="nav" aria-label="Primary">
        <div class="nav-inner">
          <span class="brand">{{name}}</span>
          <span class="nav-links">
            <a href="#how-it-works">How it works</a>
            <a href="#example">Example</a>
            <a href="#docs">Docs</a>
            {{#repoUrl}}<a href="{{repoUrl}}">GitHub</a>{{/repoUrl}}
          </span>
        </div>
      </nav>
      <div class="hero">
        <div class="wrap">
          <p class="eyebrow">{{name}}{{#version}} · v{{version}}{{/version}}</p>
          <h1 class="title">{{headline}}{{#headlineHighlight}} <span class="title-accent">{{headlineHighlight}}</span>{{/headlineHighlight}}</h1>
          <p class="tagline">{{tagline}}</p>
          <div class="hero-actions">
            <a class="button button-primary" href="#quickstart">Get started</a>
            {{#repoUrl}}<a class="button button-secondary" href="{{repoUrl}}">View on GitHub</a>{{/repoUrl}}
          </div>
          {{#install}}
          <div class="install">
            <code><span aria-hidden="true">$ </span>{{{installHtml}}}</code>
            <button class="copy" type="button" data-copy="{{install}}" aria-label="Copy {{install}}">Copy</button>
          </div>
          {{/install}}
        </div>
      </div>
    </header>
    <main>
      <section id="how-it-works" aria-labelledby="how-it-works-heading">
        <div class="wrap">
          <p class="section-label">The mental model</p>
          <h2 class="section-title" id="how-it-works-heading">Contract first. Surfaces follow.</h2>
          <p class="section-intro">Toolcraft keeps the operation in one place and derives the ways people and agents invoke it.</p>
          <ol class="steps">
            <li class="step"><span class="step-number">01</span><h3>Define the contract</h3><p>Describe params, secrets, services, output, and the handler together.</p></li>
            <li class="step"><span class="step-number">02</span><h3>Expose the surfaces</h3><p>Run the same tree as a CLI, MCP server, or typed in-process SDK.</p></li>
            <li class="step"><span class="step-number">03</span><h3>Govern the risky parts</h3><p>Add preconditions and human approval without rewriting the operation.</p></li>
          </ol>
        </div>
      </section>
      <section id="example" aria-labelledby="example-heading">
        <div class="wrap">
          <p class="section-label">See the mechanism</p>
          <h2 class="section-title" id="example-heading">One handler, every surface</h2>
          <p class="section-intro">Write the command once. CLI flags, the MCP tool, and the SDK method all come from the same definition.</p>
          <div class="flow">
            <pre class="flow-source">{{{exampleSourceHtml}}}</pre>
            <div class="flow-surfaces">
              {{#example.surfaces}}
              <article class="flow-surface">
                <div class="flow-surface-head"><span class="flow-surface-name">{{name}}</span></div>
                <pre class="flow-surface-code">{{{codeHtml}}}</pre>
              </article>
              {{/example.surfaces}}
            </div>
          </div>
        </div>
      </section>
      <section id="use-cases" aria-labelledby="use-cases-heading">
        <div class="wrap">
          <p class="section-label">What you'll build</p>
          <h2 class="section-title" id="use-cases-heading">Use cases</h2>
          <p class="section-intro">One command tree, wherever the work shows up.</p>
          <div class="use-cases">
            {{#useCases}}
            <article class="use-case">
              <div class="use-case-text">
                <h3>{{title}}</h3>
                <p>{{description}}</p>
              </div>
              <pre class="use-case-code">{{{exampleHtml}}}</pre>
            </article>
            {{/useCases}}
          </div>
        </div>
      </section>
      <section id="features" aria-labelledby="features-heading">
        <div class="wrap">
          <p class="section-label">Declared once</p>
          <h2 class="section-title" id="features-heading">Built in</h2>
          <p class="section-intro">Schema, secrets, preconditions, and services are configuration — not boilerplate in every handler.</p>
          <div class="features">
            {{#features}}
            <article class="feature">
              <h3>{{name}}</h3>
              <p>{{description}}</p>
            </article>
            {{/features}}
          </div>
        </div>
      </section>
      <section id="docs" aria-labelledby="docs-heading">
        <div class="wrap docs-layout">
          <div>
            <p class="section-label">Documentation</p>
            <h2 class="section-title" id="docs-heading">Start with the job in front of you.</h2>
            <p class="section-intro">Learn the mental model once, then jump directly to the runtime or safety feature you need.</p>
            <a class="text-link" href="docs/">Read the Toolcraft guide <span aria-hidden="true">→</span></a>
          </div>
          <div class="docs-grid">
            <a class="doc-card" href="docs/#first-command"><span>01</span><strong>Start with one command</strong><small>Install, define, and run a typed CLI in five minutes.</small></a>
            <a class="doc-card" href="docs/#runtime-surfaces"><span>02</span><strong>Choose a runtime</strong><small>CLI, MCP, and SDK from the same command tree.</small></a>
            <a class="doc-card" href="docs/#safety"><span>03</span><strong>Add safety controls</strong><small>Secrets, preconditions, services, and human approval.</small></a>
            <a class="doc-card" href="docs/#migration"><span>04</span><strong>Migrate existing scripts</strong><small>Adopt Toolcraft incrementally without rewriting useful logic.</small></a>
          </div>
        </div>
      </section>
      <section id="quickstart" class="quickstart" aria-labelledby="quickstart-heading">
        <div class="wrap">
          <p class="section-label">Quickstart</p>
          <h2 class="section-title" id="quickstart-heading">Ship the first command.</h2>
          <p class="section-intro">Install Toolcraft, point your binary at a root group, and add surfaces as the project needs them.</p>
          <pre>{{{quickstartHtml}}}</pre>
          <div class="quickstart-actions"><a class="button button-primary" href="docs/">Continue in the guide</a>{{#repoUrl}}<a class="button button-secondary" href="{{repoUrl}}">Browse the source</a>{{/repoUrl}}</div>
        </div>
      </section>
    </main>
    <footer>
      <div class="wrap"><span>{{name}}{{#version}} · {{version}}{{/version}} · Node 20+</span><span>generated by <code>toolcraft-landing-page</code></span></div>
    </footer>
    <div class="visually-hidden" id="copy-status" role="status" aria-live="polite" aria-atomic="true"></div>
    {{#includeJs}}<script>{{{script}}}</script>{{/includeJs}}
  </body>
</html>`;
