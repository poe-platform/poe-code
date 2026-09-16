# Python launcher edge QA

## Execution plan

Continue from the implemented baseline and remaining gates in
[pyodide-safe-bash.md](pyodide-safe-bash.md). Preserve existing changes and README.
Use the pinned Pyodide 314.0.6 / CPython 3.14.2 runtime on Node 22.22.2 and
matched native CPython at
`/Users/kjopek/.local/share/uv/python/cpython-3.14.2-macos-aarch64-none/bin/python3.14`.

1. Read applicable instructions, safejs commands, command/shell contracts and
   current Python implementation. Inspect current public parity and lifecycle
   coverage before selecting new cases.
2. Extend maintained public differential tests for both aliases: original
   arguments in file/code/module/stdin modes, directory/zip entrypoints, option
   termination, encoding declarations, input/EOF, text/binary flush ordering,
   exit values, shutdown callbacks, exception hooks, optimization, warning
   precedence and safe-path behavior.
3. Run against built public exports before production changes. Keep failing
   regressions separate from existing passes. Add an in-memory unit assertion
   for delivery of the invoked alias to the worker before implementing it.
4. Fix only reproduced bugs, run all Python command units, focused ESLint,
   maintained package typecheck and integration membership checks.
5. Provision document assets through the maintained integration provisioning
   command into this checkout's ignored `/out` directory. Run the normal
   `npm run build` to completion before public verification.
6. Run the maintained public integration route with the exact native Python and
   provisioned offline cache. Count failing required TODOs separately from
   unexpected failures, skips and passes.
7. Run current real worker/stdio and launcher acceptance suites. Capture the
   built CLI with the maintained screenshot tool and inspect successful original
   argument output and safe-path local import refusal.
8. Record measured results and purge this run's temporary evidence/cache from
   `/out`. Do not change readiness, commit, push or release based on subset passes.

## Reproduced bugs

The built public adapter exposes internal startup arguments in `sys.orig_argv`:
native Python preserves `python -Bu -c CODE ARGS`, while the adapter reports
`[worker eval] -B -u -c ''`. Both aliases fail the differential regression.
The in-memory transport assertion also fails because invocation messages omit
the invoked alias. Preserve the alias and unmodified operands separately from
mode-specific `sys.argv`; old custom start messages retain a `python` default.

The built adapter also reports `sys.flags.safe_path == True` for `-P` while
retaining `''` in `sys.path`; native Python omits it. Remove Pyodide's implicit
bootstrap cwd entry before adding explicit environment paths and mode-specific
paths. Required regressions also check local import refusal under `-P`, `-I`
and `PYTHONSAFEPATH`, and admission through explicit `PYTHONPATH` under `-P`.

## Acceptance limits

The command and shell contracts expose byte sources/sinks, input provenance and
optional seekable input, but no terminal/PTY/session contract. No-operand Python
therefore consumes noninteractive source; `isatty()` remains false. Interactive
REPL use, `-i` and `PYTHONINSPECT` remain required compatibility gaps, rather than
being certified by noninteractive passes.

Quota descriptors, retained directory/no-follow/descriptor-relative operations,
all-backend fidelity, native processes/threads, unrestricted networking, hard
resource confinement and Cloudflare remain separate open acceptance gates.
Selected command and document passes do not establish full CPython compatibility.

## Measured verification — 2026-09-16

Working-tree baseline HEAD: `06fac91e776c2c56c8a1ad9036ebaca60f55d67a`.
Existing unrelated work was preserved. Production changes are confined to the
Python command transport and launcher; no filesystem implementation changed.

| Check | Result |
| --- | --- |
| Normal `npm run build` | Pass, including maintained workspace membership and root suffix stages. |
| Python command units | 144/144 pass; runtime alias transport assertion failed before the fix. |
| Matched native CPython public command parity | 106/106 entries pass across both aliases, including all 50 new differential entries and canonical edit/isolation coverage. |
| Complete maintained public integration route | 124 passes, three failing required TODOs, zero unexpected failures/cancellations/skips; runner status zero does not certify the TODO requirements. |
| Launcher and command acceptance integrations | 82/82 entries pass; explicit runtime provisioning, no unexpected failures/skips/TODOs. |
| Current real product worker and stdio integrations | 45/45 pass; cancellation, concurrent binary pipelines, raw bytes, backpressure and worker retirement remain working. |
| Integration membership | 109/109 pass. |
| Maintained `virtual-bash` typecheck | Pass, including public consumer and required negative profiles. |
| Focused ESLint and whitespace checks | Pass. |
| Built CLI screenshots | Three inspected: original alias/flags/arguments, safe-path local import refusal, and host PTY readiness with guest `False False False` TTY status. |

The screenshots use the maintained `npm run screenshot` route against
`node dist/bin.cjs`, an explicitly rooted ignored `/out` directory, the pinned
runtime module URL and `--python-trusted`. The PTY capture uses
`POE_SCREENSHOT_PTY=1`; it verifies host UI behavior without treating it as a
guest terminal implementation.

The public document/lifecycle portion contributes 18 passes and three failing
required TODOs: memory and delayed `TemporaryDirectory` descriptor cleanup,
plus quota-backed reads/writes/recovery. Each failure concretely reports
`ENOTSUP`; none is reclassified as a supported workflow. The ordinary document
create/edit/reopen and streaming checks remain passing, as do offline reuse,
installer diagnostics, setup recovery, cancellation and output exhaustion.

Temporary evidence, screenshots, CLI fixtures and this run's provisioned cache
were purged after inspection. Readiness remains draft and finalization pending.
No commit, push, remote-main delivery or release was performed.
