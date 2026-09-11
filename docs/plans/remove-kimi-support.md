# Remove Kimi agent support

The user requested removal of Kimi from poe-code. Remove the Kimi and kimi-cli registrations, provider, spawn adapter/configuration, MCP configuration, Python agent identifiers and live E2E model setup. Preserve local installations and all user configuration files. Keep historical research, journals and legitimate model-name parser fixtures unchanged.

The capability regression first failed because Kimi was still recognized. Validate unknown-agent behavior for both identifiers, retained agent/provider/harness behavior, Python parity, current CLI help snapshots and a rendered CLI screenshot. Run the normal build and maintained lint before delivery. Root coordinates commits, pushing and release monitoring.

The affected 70-file run passed 1,645 tests and exposed one stale description in a fixture migrated from Kimi to Goose. After correcting that description, the three affected files passed 33 tests, including rejection of both removed identifiers through the CLI. The Python workspace passed 29 tests and TypeScript lint passed. Two current CLI snapshots were updated. These targeted results preserve the earlier successful suites; they are not a new full-repository test pass.

The normal build passed, but an actual built CLI check exposed an obsolete provider bundle retained from the earlier checkout. The bundler now removes regular provider JavaScript/declaration outputs whose source file no longer exists, after successful bundle policy validation. A memory-filesystem regression failed in two cases before the fix; all nine bundle tests passed afterward. Rebundling passed, both built CLI identifiers now produce Unknown agent, and the rendered spawn help excludes Kimi. No local agent installation or configuration was removed.

Full maintained lint completed successfully: all 10,681 configured files were linted, with zero errors and one unused-import warning in the removed provider tests. The unused import was subsequently removed. TypeScript and workflow checks passed. Broad maintained unit validation remains required before delivery.
