# Deterministic missing core-properties model defaults

Only `adapt-upstream-tables-bdd` remains active. Owned changes are the distinct
core-default creation hunk in `package-view.ts`, new
`core-defaults-workflow.test.ts`, this plan and the retained core-default logs in
`docs/docx/numbering-model-evidence-20260915`. The coordinator owns atomic commits
and maintained checks; no README, push or release work is authorized.

The exact source default factory in `src/docx/opc/parts/coreprops.py` at pinned
`e45454602b53e8e572b179ccf1c91093ec9f4ed7` from
https://github.com/python-openxml/python-docx initializes title, last modifier,
revision 1 and a clock-derived modified timestamp. Project-specific identity is
replaced by original title `Document` and admitted author. Host clock reads map to
explicit admitted timestamp, rounded to whole seconds as the documented metadata
setter does; omitted timestamp uses the existing documented deterministic admission
value 1980-01-01 UTC. This is an explicit language/determinism mapping, not a claim
that source runtime timestamps were reproduced.

Two original memfs cases failed before code (`core-defaults-red.log`). Missing
core-properties creation now fills defaults in the staged candidate BEFORE its
single package publication, including its relationship and content-type entry.
Repeated reads retain the same part owner; existing parts are not reinitialized.
`core-defaults-green.log` records both new cases and twenty existing/numbering
cases passing. The BDD worker independently reruns exact workflow 057 through
Document and records its own source-case evidence.

Renderer QA: **not run**; this profile asserts stored metadata and ownership,
without visual behavior or layout changes. Whole-public-API and later task
obligations remain separate.

## Maintained expectation reconciliation

The maintained unit route exposed three historical expectations that assumed an
empty modified timestamp or omitted character/table defaults. Independent focused
execution confirmed these exact three failures in `default-expectations-red.log`
before updating any assertion. `package-behavior-variants.test.ts` retains its
single-owner checks and now asserts exact deterministic modified time and revision
1. `styles-model.test.ts` asserts the exact five-name list after its two additions,
including all three new type defaults. `collection-value-protocols.test.ts` checks
the real character default name/type while retaining the explicit null-lookup
contract through an original fixture with no character default. The three files
pass all 160 fast tests (`default-expectations-green.log`) and owned ESLint passes;
no API checks were removed or weakened.
