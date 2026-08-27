# Compiled legacy v2 — frozen author-only ESM revision

August 27, 2026. Candidate stays eba049535d154f4e028f57ffd8efd7622b2239ca.
Preserve cf59762539aff3f5454ad9b048598fdff4268b2c and all older raw results.
No product/config/legacy assertion changes, private queries, builds, packs, installs,
other-worker data access, retries or broader proof iterations.

The new bootstrap changes CommonJS require to explicit ESM import, dynamically
imports the same exact generated worker URL, reports completion only after that
import resolves, and calls parentPort.close(). The parent observes the unchanged
product ready message, the author import-completion message, and the actual worker
exit/error facts. It makes no separate port-close observation claim. The pinned
Node22 module/eval profile, worker bytes and 300-second outer deadline remain.
PROBE-DIFF.patch.data binds the exact old worker_probe snippet to the new probe,
including its bootstrap string. FREEZE.json binds every orchestration input; these
files must be committed and byte-identical before any runtime attempt.

Reuse only this author's regular compiled snapshot after checking its complete
file/directory inventory, Git archive bytes, all-src/nine-path identities, selected
tools and dist against the three immutable cf597 manifests. Drift stops, never
repairs. Use fresh v2 evidence/HOME/TMP. Static-parse both ESM snippets with pinned
Node22, then execute one readiness attempt. On valid readiness pass, run the exact
original 27-entrypoint 505 command once, then the six-entrypoint 203 command and
original focused/source-wide noEmit commands, stopping at any nonpass. No new test
cases or skipped assertions. Checks capture unexpected regular entries too.

Current file presence is not readiness. New passes cannot rescore the old 18
failures. Build/readiness/static/type processes are not test rows. Prior 42 source
checks, other workers' public/SafeJS results, global type diagnostics and the five
original custom first-read requirements remain separate. No full gate, release,
promotion or independent review claim. End after the bounded handoff.
