# Preparation chronology

This is a new, post-candidate, source-inspected workflow protocol, not a pre-source
freeze or a replay/rescore of the accepted timeout public cohort.

Before any workflow or product import, the first `prepare.mjs` invocation exited 1
at `HASH:tests/integration/timeout-public-author-20260828/evidence/PACKAGE-FILES.json`.
The stale working-note expected SHA was
`35e737e4261a685a2fac3e1e7e9eb1fb460c079a3d2933b2b8bffe26839bcb04`;
the actual SHA was
`0174f8e3c54901af482aa9e87adee4065ac971489a9cdf6875e755b19c5172ec`.
Direct `git show 2736db840369a51dd76e7f5cc115bd44fe8e0f54:.../PACKAGE-FILES.json`
and the already accepted independent `AUTHOR-BINDINGS.json` both authenticate
the latter. The author artifact is unchanged. This is a corrected preparation
pin, not a product failure, relaxed hash guard, or an actual-cohort retry.
The command output was visible in the tool transcript; no standalone raw file
was captured, and this note does not reconstruct missing raw bytes.

Private AGENTS instructions were read for applicable instructions only, never
copied or treated as evidence inputs. All 264 selected engine files matched the
historical authenticated snapshot and private HEAD bb23ec27 before staging.
