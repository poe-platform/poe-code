# Current document qualification

Run against the working tree on 2026-09-16. Preserve existing changes and
historical captures. This plan covers package/document acceptance, not full
filesystem preservation, hostile-code isolation or Cloudflare deployment.

1. Read `pyodide-safe-bash.md`, applicable AGENTS.md and the browser fixture.
2. Use the isolated pinned Pyodide 314.0.6 installation. Start the existing
   `browser-documents/server.mjs` with a fresh capture path under `out`.
   `/out` is read-only on this host; use checkout-local `out` and purge it after
   recording results. Never overwrite historical captures.
3. Open the fixture in real Chrome with Playwright. Wait for `window.finished`.
   Inspect MEMFS, immediate/delayed canonical and root-canonical reports,
   resolved distribution versions, index/source hashes, parent byte equality
   and open-handle census. Imports alone do not qualify libraries.
4. Inspect the browser summary screenshot and PyMuPDF-rendered PDF page.
   Record actual browser/runtime versions and any failed assertion groups in
   `packages/safe-bash/docs/pyodide.md`.
5. Provision the public document profile separately with
   `SAFE_BASH_PYTHON_CACHE` naming an absolute owned directory under `out`.
   Run `public-documents.test.mjs` with that offline cache. Extend its actual
   `python FILE` coverage with the same qualified ordinary script. Diagnose
   failures from the generated report before changing production code.
6. Run the focused real-runtime inventory test, JavaScript syntax checks and
   maintained ESLint route. Keep runtime downloads and host writes outside
   fast unit tests. Report gates separately and retain unsupported workflows.
7. Stop owned servers/browser sessions, record results, and purge owned scratch.
   Do not commit, push, publish or change overall readiness.
