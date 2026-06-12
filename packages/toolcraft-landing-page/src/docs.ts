export const DOCS_HTML = String.raw`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <meta name="description" content="Task-first guide to defining Toolcraft commands and exposing them through CLI, MCP, and SDK surfaces.">
    <title>Toolcraft guide</title>
    <style>
      :root { color-scheme: light dark; --bg: #fff; --soft: #f6f5f8; --ink: #18181b; --muted: #5f5f69; --line: #a0a0aa; --accent: #a200ff; --code: #f1eff4; --sans: ui-sans-serif, system-ui, sans-serif; --mono: ui-monospace, SFMono-Regular, Menlo, monospace; }
      * { box-sizing: border-box; }
      html { scroll-behavior: smooth; }
      body { margin: 0; color: var(--ink); background: var(--bg); font-family: var(--sans); line-height: 1.65; }
      a { color: var(--accent); text-underline-offset: 4px; }
      a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
      code, pre { font-family: var(--mono); }
      pre { max-width: 100%; overflow-x: auto; padding: 18px; border: 1px solid var(--line); border-radius: 10px; background: var(--code); }
      .layout { width: min(calc(100% - 40px), 1100px); margin: 0 auto; display: grid; grid-template-columns: 230px minmax(0, 720px); gap: 64px; }
      .layout > * { min-width: 0; }
      aside { position: sticky; top: 0; align-self: start; min-height: 100vh; padding: 32px 0; border-right: 1px solid var(--line); }
      .brand { color: var(--ink); font-family: var(--mono); font-weight: 800; text-decoration: none; }
      nav { display: grid; gap: 8px; margin-top: 38px; padding-right: 28px; }
      nav a { padding: 7px 0; color: var(--muted); text-decoration: none; }
      nav a:hover { color: var(--accent); }
      main { padding: 72px 0 100px; }
      header { padding-bottom: 48px; border-bottom: 1px solid var(--line); }
      h1 { max-width: 680px; margin: 12px 0; font-size: clamp(42px, 7vw, 68px); line-height: 1; letter-spacing: -.045em; }
      h2 { margin-top: 72px; font-size: 30px; line-height: 1.2; }
      h3 { margin-top: 32px; }
      .eyebrow { color: var(--accent); font-family: var(--mono); font-size: 12px; letter-spacing: .08em; text-transform: uppercase; }
      .lead { max-width: 660px; color: var(--muted); font-size: 19px; }
      .callout { margin: 28px 0; padding: 18px 20px; border-left: 4px solid var(--accent); background: var(--soft); }
      .cards { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; }
      .card { padding: 18px; border: 1px solid var(--line); border-radius: 10px; }
      .card h3 { margin-top: 0; }
      .card p { margin-bottom: 0; color: var(--muted); }
      footer { margin-top: 72px; padding-top: 28px; border-top: 1px solid var(--line); color: var(--muted); }
      @media (prefers-color-scheme: dark) { :root { --bg: #111113; --soft: #19191d; --ink: #f4f4f5; --muted: #c4c4cc; --line: #4a4a55; --accent: #d8a7ff; --code: #202026; } }
      @media (max-width: 760px) { .layout { grid-template-columns: 1fr; gap: 0; } aside { position: static; min-height: 0; padding: 20px 0; border-right: 0; border-bottom: 1px solid var(--line); } nav { grid-template-columns: repeat(2, 1fr); margin-top: 18px; padding: 0; } main { padding-top: 48px; } .cards { grid-template-columns: 1fr; } }
      @media (prefers-reduced-motion: reduce) { html { scroll-behavior: auto; } }
      @media print { aside { display: none; } .layout { display: block; width: 100%; } main { padding: 0; } pre { overflow: visible; white-space: pre-wrap; } }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside>
        <a class="brand" href="../">toolcraft</a>
        <nav aria-label="Guide">
          <a href="#first-command">First command</a>
          <a href="#mental-model">Mental model</a>
          <a href="#runtime-surfaces">Runtime surfaces</a>
          <a href="#safety">Safety</a>
          <a href="#migration">Migration</a>
          <a href="#packages">Packages</a>
        </nav>
      </aside>
      <main>
        <header>
          <p class="eyebrow">Toolcraft guide</p>
          <h1>Build the operation once.</h1>
          <p class="lead">Define typed commands around the work your project already does, then expose the same tree to humans, agents, and application code.</p>
        </header>

        <section id="first-command">
          <h2>Your first command</h2>
          <p>Install the runtime (the <code>S</code> schema builders ship with it):</p>
          <pre>npm install toolcraft</pre>
          <p>Define one command with its contract and handler together:</p>
          <pre>import { defineCommand, S } from "toolcraft";

export const greet = defineCommand({
  name: "greet",
  params: S.Object({ name: S.String() }),
  handler: async ({ params }) =&gt; ({ message: "Hello, " + params.name })
});</pre>
          <p>Put commands under a root group and pass that root to the runtime you need.</p>
        </section>

        <section id="mental-model">
          <h2>The mental model</h2>
          <div class="callout"><strong>Command definitions own contracts. Runtime adapters own transport.</strong> Your handler should not parse argv, speak JSON-RPC, or know how the caller reached it.</div>
          <ol>
            <li><strong>Define:</strong> params, secrets, services, requirements, output, and handler.</li>
            <li><strong>Compose:</strong> arrange commands into groups and a single root tree.</li>
            <li><strong>Expose:</strong> hand that root to CLI, MCP, or SDK adapters.</li>
            <li><strong>Govern:</strong> add approvals and preconditions at the command boundary.</li>
          </ol>
        </section>

        <section id="runtime-surfaces">
          <h2>Choose runtime surfaces</h2>
          <div class="cards">
            <article class="card"><h3>CLI</h3><p>Use <code>runCLI</code> for argv parsing, help output, validation, rendering, and exit codes.</p></article>
            <article class="card"><h3>MCP</h3><p>Use <code>runMCP</code> to expose eligible commands as generated MCP tools over stdio.</p></article>
            <article class="card"><h3>SDK</h3><p>Use <code>createSDK</code> for typed, in-process calls in applications and tests.</p></article>
            <article class="card"><h3>OpenAPI</h3><p>Use <code>toolcraft-openapi</code> to scaffold commands from an existing contract.</p></article>
          </div>
        </section>

        <section id="safety">
          <h2>Add safety controls</h2>
          <p>Keep operational policy declarative and next to the command:</p>
          <ul>
            <li>Declare required and optional secrets instead of reading environment variables throughout handlers.</li>
            <li>Inject clients and services at the runtime boundary for testable handlers.</li>
            <li>Use preconditions for machine-checkable requirements.</li>
            <li>Use human-in-loop approval for destructive or production actions.</li>
            <li>Limit which commands are exposed through each runtime surface.</li>
          </ul>
        </section>

        <section id="migration">
          <h2>Migrate existing scripts</h2>
          <p>Do not rewrite working business logic. Wrap one script at a time:</p>
          <ol>
            <li>Move argv and environment parsing out of the script body.</li>
            <li>Describe those inputs as Toolcraft params and secrets.</li>
            <li>Call the existing function from a command handler.</li>
            <li>Add the command to the root and keep the old entrypoint until callers move.</li>
            <li>Expose MCP or SDK only when the operation benefits from another caller.</li>
          </ol>
        </section>

        <section id="packages">
          <h2>Package guides</h2>
          <ul>
            <li><a href="https://github.com/poe-platform/poe-code/tree/main/packages/toolcraft">toolcraft</a> — command definitions and CLI, MCP, and SDK runtimes.</li>
            <li><a href="https://github.com/poe-platform/poe-code/tree/main/packages/toolcraft-schema">toolcraft-schema</a> — schema builders, static types, and JSON Schema.</li>
            <li><a href="https://github.com/poe-platform/poe-code/tree/main/packages/toolcraft-openapi">toolcraft-openapi</a> — command generation from OpenAPI.</li>
            <li><a href="https://github.com/poe-platform/poe-code/tree/main/packages/toolcraft-codemode">toolcraft-codemode</a> — compact agent-facing search, schema, and execute tools.</li>
          </ul>
          <h3>Configuration and environment</h3>
          <p>The landing-page package itself has no runtime environment variables. Command-specific configuration belongs to the relevant Toolcraft package and command definitions.</p>
        </section>

        <footer><a href="../">Back to the Toolcraft overview</a></footer>
      </main>
    </div>
  </body>
</html>`;
