# D13 source-only adjudication; original FAIL retained

The unchanged DATA cohort remains **15/16**, with coordinator exit1. D13
incorrectly required the string `directExecutor` inside `src/commands/find.ts`.
It is instead constructed by `src/commands/index.ts` and passed into find.
No expectation, executable, original receipt or cohort result was rewritten or
rerun. This is a source-reading resolution, not a sixteenth dynamic pass.

All references below name bytes inside the authenticated selected8437 archive,
not current checkout source. D01/D02 established all268 selected inputs against
the independently accepted complete membership/authority; D13 failed only at
its incorrectly located string predicate. The archive encoded SHA256 is
`a49b8a7055ac2902d1368ddb638d62c5a1896dc9ed25c18b025816a710077509`.

| Frozen source | SHA256 | Relevant route |
| --- | --- | --- |
| src/commands/index.ts | 67a0e34ea9a8518d2349b4707ef5214e9da0de790ea5c1973daac71dabc70aa9 | 19–28: `directExecutor(...)` creates `execute`, passed to `findCommands(execute)` |
| src/commands/find.ts | 534a5359a42bb7bf0020f21092740262edbe9053744e29d153fa9e6319539db2 | 86–95: `-exec ... ;` substitutes literal argv then awaits injected `execute`; 136–161: sorted, serial directory traversal |
| src/commands/execution.ts | 61940d3b86593243c13cab716be87f84647e42b69476757482dfebafc7d693a6 | 5–14: available `context.invoke` receives command/argv and stdin/cwd/env/sinks/provenance |
| src/shell/runtime.ts | 100361256ee71d7a263c92fa607de31ec1d3be9b1fb5c601b337c19e700ac4b3 | 2224–2266: invokeChild→invokeScoped→literal simple command→runCommandIsolated; 1478,1503: dispatch→dispatchScoped; 1517–1535: child context and composeMiddleware |

Thus P16's two literal rg children enter the middleware through the existing
canonical invocation route. Top-level find precedes both; sorted serial find
visits preserve `notes/a b.txt` before `notes/z.txt`. The pipeline's sed may
appear in any of the four declared linear extensions. No product was imported
to obtain this conclusion. Existing frozen SOURCE-EXCERPTS.json SHA256
`324d1179d90269188644d54101f81ded9d03eaa6f59e9dffd164f905b03c76f1`
provides the previously authenticated source excerpts; the invoke method and
dispatch sites were additionally read directly from the bound archive in memory.

This resolves a reviewer assertion assumption, not a product regression. It
does not upgrade original P16 STOP_UNDECLARED_STAGE into a pass, authenticate
unobservable identical-tuple provenance, or establish actual run02 outcomes.
