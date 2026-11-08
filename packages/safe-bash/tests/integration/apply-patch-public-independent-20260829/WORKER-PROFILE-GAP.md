# Four maintained failures: reviewer permission profile, not apply_patch finding

Original one-attempt child026 and FINAL remain immutable, exit1. No retry,
permission change, assertion relaxation or source fix was performed. All four
failures occur in the frozen selected tests/plugins/agent-commands.test.ts
(SHA256 d19dd492d498c3a7754b93cc9041615ab8011b4eacbbca3a64df8011cb8c46a2).
They are unrelated to the two approved fixture corrections.

| TAP row | Exact maintained case / route | Expected | Actual |
| --- | --- | --- | --- |
| 69 | definitions fallback resolves nested argv across families without a shell; direct env→env→rg a - with stdin `a\n` | status0, stdout `a\n`, stderr empty | status2, stdout empty, stderr `rg: Access to this API has been restricted. Use --allow-worker to manage permissions.\n` |
| 70 | plugin fallback resolves nested argv across families without a shell; same literal route | same | same |
| 75 | aggregate forwards search limits without rewriting them; `{search:{maxLineBytes:1}}`, `rg x -`, stdin `xxxx\n` | nonzero status, diagnostic matching `/limit/u` | worker permission diagnostic instead |
| 80 | search defaultInput remains an explicit family override; VFS `/file=match\n`, `{search:{defaultInput:"stdin"}}`, `rg match` | status1, stdout empty | status2 at the first assertion; later assertion unexecuted |

Frozen source lines75–85,109–128 and129–138 define these cases. Exact compiled
locations, stack/expected/actual bytes are in RESULTS.json.canonical.failures and
raw child026. For row80 the TAP record captures only `2 !== 1`; its stderr is
not directly captured by that assertion. Attribution to the same Worker denial
there is **source-route inference**, not a fabricated captured stderr.

The selected regex-execution/client.ts:79 constructs a real Worker and line80
uses `execArgv: []`. That module and search implementation are unchanged from
accepted base d111; the public integration adds no regex changes. The review's
Node command deliberately omits --allow-worker, so the first three diagnostics
identify the exact incompatible harness prerequisite. No Worker lifecycle was
exercised/accepted here. No native/network fallback was used.

If ROOT requires83/83 maintained closure, authorize a separate narrow versioned
reviewer-harness continuation of ONLY these four unchanged tests, using the same
authenticated full898 package. It needs an explicitly bounded existing regex
Worker role: admitted package URL/bytes, worker module-load/source binding,
startup/terminal/cleanup/capture bounds and observed retirement. Merely adding
--allow-worker does not establish inherited module-hook coverage, particularly
because the product explicitly clears execArgv. No product change, rebuild,
fixture rewrite, full public/layout replay or native oracle is necessary to
design that continuation. This document is a proposal, **not GO**.

The currently proven public wiring/limits/default79 outcomes can be accepted
with this exception explicitly retained. Neither79/83 nor the coordinator's
accepted:false flag is rewritten to manufacture a green whole review.
