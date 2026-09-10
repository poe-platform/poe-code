# Integrate reviewed open pull requests

The user requested review, cherry-picking and integration of open PRs into main, followed by release. Work uses a clean main checkout; unfinished issue 686 changes remain untouched in the prior checkout. Initial remote main was `835d1a24bd678a7c9410dfb9263fe8c397035d08`.

## Reviewed scope

- 710: portable device comparison; one unique commit.
- 711: atomic resize contract and two regression refinements. Preserve newer main fixture fixes instead of importing its obsolete fixture commit or reconciliation merge.
- 712: archive parser compatibility and both discovery/fixture follow-ups.
- 713: typed curl output diagnostics.
- 714: optional response-body intent for curl transports and consumer checks.
- 715: runtime model selection, MCP fixture handling and Goose model catalog. Preserve main's newer Node20 compatibility fixes. Remove its workflow-YAML unit test under the explicit repository instruction and validate workflows with actionlint.
- 716: superseded by main's existing lexical navigator injection and identical Toolcraft collection fix; do not duplicate the changes.
- 717: retained intrinsic roots cache, applied once despite its duplicate inclusion in 715.
- 415: superseded by 432's proposed dependency updates.
- 432: retain current explicit pins, newer security versions and dependency topology; reconcile only the twelve reviewed compatible package records. ACP changes already landed and E2B was removed.
- 411: selectively reconcile useful documentation against current code, preserving newer documentation and omitting obsolete test changes or unsupported claims.

Each original logical code change retains its own commit. Review historical failed CI as evidence, then validate the integrated state with focused checks, normal build, maintained broad tests, lint, public package checks and relevant visual validation. Verify remote main after pushing, close PRs with their actual disposition, and monitor all triggered release workflows through completion. Report local commits, remote delivery and publication separately.

Validation and final PR dispositions remain pending.
