# Public converter import isolation evidence

The existing root SDK/plugin wiring is retained. The original TypeScript PPTX
adapter is now loaded only when its reader or writer executes; cancellation is
checked before and after module admission. No native engine or fallback is added.
Text imports retain shared archive codecs and PDF support, but exclude the
presentation and DOCX engines. This is an import-graph check, not a host sandbox.

Original public-consumer reproduction: the new static graph assertion failed
because PPTX sources were eagerly reachable. The other three existing public
export, type and registration checks passed in that run (see
[red evidence](text-office-isolation-red.log)). The updated check validates static
and optional graphs separately; dynamic imports must be literal relative chunks.
Artifact writes in the check use memfs; no unit executable or host scratch file
is introduced.

Current verification:

- `npm run build:workspaces -- --workspace=virtual-bash`: passed, using the
  maintained declaration-derived dependency closure.
- Pandoc workspace lint/typecheck: passed.
- Pandoc workspace tests: 47 files / 1,063 tests passed, including PPTX conversion.
- Full `npm run build`: passed, including workspace and root suffix stages.
- Focused public/bundle checks: 3 files / 58 tests passed.
- Full `npm run lint`: passed (ESLint, type contracts and workflow lint).
- Manual public SDK/plugin QA: text conversion, PPTX round trip, shell execution,
  collision preflight and explicit replacement passed with ambient fetch denied.
  Initial QA incorrectly expected `Shell.use` to throw synchronously; setup is
  deferred. Corrected QA checked both direct preflight and rejection from exec.
  Both initial and corrected evidence are retained.
- Isolated published TypeScript QA: 56 reachable declaration files copied into
  memfs, rewritten with maintained `rewriteWorkspaceDts`, compiled with strict
  NodeNext and zero diagnostics. No private manifests or workspace symlinks.
- `npm pack --dry-run --ignore-scripts --json`: passed. Both public entries,
  declarations and all 14 reachable runtime files (including canonical filesystem
  core and optional chunks) are present. Private unbundled Pandoc JS is absent.
  Reachable imports contain no native filesystem/process imports; the only
  admitted Node builtins are async_hooks, crypto, os and util.
- `npm run lint:packages`: failed on missing Pandoc/PDF READMEs. No README additions
  are authorized by the repository instruction, so those files were not created.
- Full `npm test`: initial run reported other-workspace timeouts while lint was
  running and was stopped. Retry after lint completion finished with 24 failed
  tests across 23 files, one worker-start error, 129,676 passed and 2 skipped.
  Reported failures are outside Pandoc; the shared unit task failed, so later
  workspace unit tasks were not certified. Neither run is a passing integration
  gate. Detailed failures are in `text-office-isolation-full-test-final.log`.

Procedures are in [the plan](../plans/pandoc-text-office-isolation.md). Detailed
command output is retained alongside this file with the `text-office-isolation`
prefix. Agent command inventory, sealed fixtures and unrelated changes are
preserved. No push or release is authorized.
