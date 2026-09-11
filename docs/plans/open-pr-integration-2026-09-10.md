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

## Local validation

- Normal build passed before unit validation. Run it again after unit dependency builds to restore root browser bundle suffixes before final packaging.
- Full maintained lint passed: 10,685 configured files, zero errors or warnings, plus TypeScript and actionlint. An earlier incomplete run correctly detected creation of the screenshot directory during scanning; the stable-root retry passed without guard changes.
- The full uncached maintained unit route passed shared tasks (22,500 tests; two skipped), Bash (29,777 passed; 86 skipped), and SafeJS (21,665 passed; 37 skipped), then failed two terminal-pilot five-second deadlines. The unchanged terminal workspace rerun passed all 288 tests. A verified screenshot fixture resource leak was corrected by closing its runtime in finally; all 288 passed again with the original deadlines. This is not proof that the resource leak caused both timeouts.
- The declaration-derived plan places terminal-pilot last. The maintained terminal workspace rerun includes its build hook; the remaining root lint-stress posttest passed both tests. Earlier successful suites were preserved rather than repeated for a test-only cleanup.
- Focused filesystem, truncate, archive, network and provider checks passed. CLI help was rendered with the maintained screenshot renderer against the built CLI and visually inspected. Goose's actual test command passed. Kimi's existing local and isolated configuration lack a provider; no persistent configuration repair was performed without the pending approval.
- Initial installed Node/Bun/types consumers passed. Browser qualification exposed an ordering error: unit dependency builds had overwritten the root browser bundle with TypeScript output. Final packaging must follow the normal root build; no export-source change was warranted.

## Delivery

The ancillary terminal-png release failed in run 34500155080 because its manual build order omitted toolcraft-schema before tiny-stdio-mcp-server (TS2307). Replace the three manual package builds with the maintained terminal-png-mcp workspace dependency closure. Validate with workflow lint and the selected workspace build before pushing the correction; monitor the replacement release through publication.

PR 716 was closed as superseded by existing main fixes. Other PRs remain open until reviewed changes are verified on remote main. Final normal build, all 22 installed-consumer stages (scoped Node/Bun/types/browser, legacy, standalone FS and root Node/Bun), and final full guarded lint passed. Push, remaining PR dispositions and both release publications remain pending.
