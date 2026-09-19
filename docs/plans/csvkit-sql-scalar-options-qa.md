# SQL scalar option qualification

Authenticate the existing frozen CPython 3.14.2 deployment against
`docs/csvkit/reference-profile.json`. Inspect csvkit 2.2.0 `parse_list`, then
capture its actual scalar conversion results under the frozen C/UTC/UTF-8
environment. Keep acquisition code and temporary logs in `out`; preserve the
reduced observations in `docs/csvkit`.

Use original fast in-memory tests to reproduce wrong float conversions and
quoted-string refusals before implementation. Compare scalar values and types,
duplicate-key precedence, and safe refusal of unqualified syntax. Exercise the
same engine through argv, SDK, and actual safe-bash with an explicitly injected
database provider, verifying stdout/stderr/status and connection/query/cleanup
effects. Native Python is reference-only and absent from canonical tests and
product execution.

Run the maintained csvkit unit/lint gates and selected safe-bash unit gate;
build the selected workspace closure without caching. Retain explicit blockers
for unmeasured compound literals, Python warning/error/traceback profiles, and
real database qualification. Do not change README, staging, commits or delivery.

During the broader CSV-family sweep, validate any contradictory historical
expectations against the frozen native reader before editing code. Preserve
the original inputs and expectations in the reduced validation record. In
particular, distinguish named universal newlines from borrowed NDJSON stdin,
and independently qualify a custom six-byte buffered sniff profile with exact
duplicate-header warnings. Keep default-pipe observations separate.
