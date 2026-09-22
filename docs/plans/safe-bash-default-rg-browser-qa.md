# Default rg browser verification

Verify this after changes to default rg or portable regex execution. Browser
bundling is a build/QA operation; keep it outside the fast unit suite.

1. Build the selected Safe Bash workspace through `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
2. Obtain `resolveBrowserShellBuild` from `scripts/bundle-safe-bash.mjs`.
   Use its declared `core.browser` entry and preserve its browser conditions,
   aliases, injected platform and capability plugins. Bundle that entry in memory
   as CommonJS with splitting and sourcemaps disabled for VM evaluation.
3. Evaluate that bundle in a fresh VM context. Supply web stream/encoding APIs,
   typed arrays, abort APIs, microtasks, performance and timers with numeric
   handles. Bind the external `poe-code/safe-fs/core` import to the current
   `@poe-code/safe-fs/core` workspace. Check that Buffer and process are absent
   from the context. Do not supply a host shell or native command fallback.
4. Create a memory filesystem and a Shell from the evaluated bundle. Register
   `agentCommands()` with no injected regex executor. Verify these commands,
   status zero, exact stdout and empty stderr:

   | Command | stdin | stdout |
   | --- | --- | --- |
   | `rg alpha -` | `alpha\nbeta\n` | `alpha\n` |
   | `rg 'a.ph[ab]+' -` | `alpha\nbeta\n` | `alpha\n` |
   | `rg -o 'a|ab' -` | `ab ab\n` | `a\na\n` |
   | `rg -o -b '.' -` | `é🦊\n` | `0:é\n2:🦊\n` |
   | `rg 'é🦊' -` | `é🦊\nbeta\n` | `é🦊\n` |

5. In the same context verify an explicitly injected `createNodeRegexProvider()`
   still supports the existing `printf 'café\n' | grep 'café'`,
   `printf 'café\n' | rg --json 'café'` and
   `printf 'café\n' | sed 's/café/tea/'` workflows. Check status zero and
   nonempty stdout. This verifies an injected matcher, not native command use.
6. Await disposal of every Shell and clear remaining numeric timer handles.
   Record executed checks and results on the issue before cleaning output.
