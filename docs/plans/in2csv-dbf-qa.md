# DBF reader implementation and QA

1. Audit csvkit 2.2.0, agate-dbf 0.2.4 and dbfread 2.0.7 in the frozen CPython profile. Capture exact output, diagnostics, status and unchanged source/companion effects in docs/csvkit.
2. Reproduce reader gaps with failing in-memory differential tests before changing TypeScript.
3. Implement bounded filename-based DBF/DBT/FPT reading using injected filesystem/codecs and the shared engine. Preserve record order, deleted-record behavior, cleanup, cancellation and awaited output.
4. Run domain tests/lint and the maintained selected workspace build. Have another agent independently stress the actual safe-bash tools and fix validated gaps, with root retaining registration/export ownership.
5. Run focused safe-bash checks and inspect a CLI screenshot where applicable. Document measured cases and explicit blockers without claiming full suite parity. Leave Git/index and unrelated changes untouched.
