# Safe Bash browser consumer QA

Execute the complete `scripts/fixtures/safe-packages-browser.mjs` workflow as an
ad hoc publication check. Its many filesystem, XML, archive, text, network and
LLM workflows exceed the fast unit deadline; keep execution outside unit tests.
The unit route still verifies its complete browser bundle has no external
imports or exports, and checks factory identity and focused portable behavior.

1. Package Safe Bash and Safe FS into a fresh owned output directory, and install
   them into an isolated consumer with their declared dependencies. Do not install
   private command workspaces.
2. Bundle the maintained browser fixture with esbuild, resolving public Safe Bash,
   Safe FS and Safe JS filesystem compatibility imports to the installed packages.
   Use browser platform, workerd/worker/browser conditions, ESM and ES2022.
3. Require the emitted graph to have no external imports or exports. Evaluate it
   in a Node VM inside an async function, providing web streams, text encoders,
   typed arrays, AbortController/AbortSignal, timers, URL, TypeError, crypto,
   performance and console. Before evaluation, assert Buffer, process and require
   are undefined.
4. Await all top-level workflows. Any thrown assertion, cancellation or rejection
   fails verification. Remove only the owned consumer and evidence after use.
