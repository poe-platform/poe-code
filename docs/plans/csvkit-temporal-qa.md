# Temporal engine QA procedure

1. Replay the frozen CPython 3.14.2 runtime hash-required lock in an owned out
   directory. Inspect Agate Date/DateTime/TimeDelta/Boolean/Text, pytimeparse,
   parsedatetime, isodate, csvstat and agate-sql source. Record unsupported paths
   in docs/specs/csvkit-temporal.md, independently from any passing case count.
2. Measure original cases and add failing canonical in-memory regressions before
   implementing casts, serialization or schema behavior. Never run an oracle,
   create files, use network or real databases inside canonical tests.
3. Run maintained csvkit workspace tests/lint and selected declared workspace
   build closure uncached. Keep five existing encoding TODOs out of pass counts.
4. Have a different agent stress actual Shell registration, exact channels/status
   and MemoryFS effects. Rebuild the public SDK before testing the adapter.
   Rerun the complete focused csvkit Shell cohort after integration. Requalify
   obsolete blocker expectations against the reference before updating them.
5. Capture the actual registered Date/aware DateTime sort, typed JSON and generic
   SQL schema output with scripts/screenshot.ts into out. Visually inspect it,
   record failed capture setup separately and purge only owned temporary evidence.
6. Preserve the failed/incomplete broad name-filter test route as such. It invokes
   an after hook without the filtered-out setup in network/http.test.ts; do not
   count it as a workspace gate. No commit/push/publication or README change.
