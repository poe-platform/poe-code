# Python package provisioning user QA

Read [current acceptance gates](pyodide-safe-bash.md) and the
[verified runtime matrix](../../packages/safe-bash/docs/pyodide.md) first.
Preserve working implementation and existing edits. No README changes.

1. Run Python command units with mocked transport and in-memory storage:
   `node --import tsx --test packages/safe-bash/tests/commands/python/*.test.ts`.
2. Build the selected workspace closure with
   `npm run build:workspaces -- --workspace=virtual-bash`.
3. Use the explicitly installed Pyodide **314.0.6** runtime for the maintained
   real integration:
   `node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/package-provisioning.test.mjs`.
   This downloads native/pure wheels through configured transport; package cache
   and user fixtures stay in memory. It is outside unit discovery.
4. Verify lazy shell startup, all document pins, native lxml/Pillow, package data,
   local modules, canonical pure/native wheels, dependencies, requirement markers,
   relative paths with spaces, named extras and transitive extras.
5. Verify subsequent invocations and new plugins reuse packages offline without
   user module mutations. Confirm incompatible desktop wheels, corrupt wheels,
   missing packages, version/dependency conflicts and unsupported pip flags fail.
6. Verify cancellation during wheel transport, explicit retry, canonical cache
   preprovisioning and integrity failure before user code.
7. Run focused ESLint, maintained workspace typecheck and the opt-in integration
   inventory. Record actual passes separately from skips and failing TODOs.

## Regression reproduced on 2026-09-16

The baseline misparsed `demo==1.0` followed by a tab and an inline comment.
It also rejected a valid inline comment ending in a backslash as a requirement
continuation. A failing in-memory test demonstrated the latter before changing
production code. Comment removal now precedes continuation validation and accepts
whitespace delimiters, preserving URL hash fragments. An actual continuation
before a comment remains explicitly unsupported. The real integration fixture
includes both valid comment cases.

These installer checks do not close retained-directory cleanup, quota descriptor,
all-backend fidelity, guest confinement or Cloudflare deployment gates.

## Measured verification

Working-tree baseline: `06fac91e776c2c56c8a1ad9036ebaca60f55d67a`, Node
**22.22.2**, pinned Pyodide **314.0.6** / CPython **3.14.2**. Existing edits
were preserved.

| Check | Result |
| --- | --- |
| Python command units | 145 pass, zero failures/skips/TODOs. |
| Real package provisioning integration | 24 pass, zero failures/skips/TODOs; includes actual matching native wheels and both requirement comment regressions. |
| Built public export smoke check | `six==1.17.0` installation from tab-comment requirements, subsequent import, fresh-plugin offline reuse, interpreter isolation and unsupported option rejection pass. Cache and canonical fixtures remain in memory. |
| Selected workspace build closure | Pass via maintained `build:workspaces` route. |
| Maintained workspace typecheck | Pass, including required public consumer and negative profiles. |
| Focused ESLint, JavaScript syntax, whitespace | Pass. |
| Opt-in runtime inventory | 1 pass; this does not itself run Pyodide. |
| Independent installer audit | 47 focused units pass; no additional reproduced bug, no edits. |
| CLI screenshot | Maintained `screenshot-poe-code` installer-help capture inspected; supported/unsupported options render correctly. Its prerequisites complete 77 uncached workspace build tasks and root bundling. Temporary screenshot purged after inspection. |

Remote delivery and releases were not requested or performed. This is scoped
installer verification, not certification of every Python/backend edge case.
