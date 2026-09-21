# Remote MCP pinned file inventory

This is the remaining-work inventory for upstream pin
`e5450d49070b48ab988d74aaf060800a493e51bc`. It enumerates every
TypeScript source below `src` and every `.test.ts`/`.test.mjs` below `tests`.
The requirement/lesson evidence is in `remote-mcp-source-audit.md` and the
121-issue ledger. Complete read means the entire listed file was read; it
does not assert every dependency or every behavior was reimplemented.

Excluded files are scope exclusions, not complete-read claims. Relevant
generic lessons from daemon/vendor/process issues retain their separate
ledger evidence. Remote transport, OAuth, exact selection, arguments, complete
output, discovery and artifact contracts are covered by the source map.

## Source inventory

127 complete reads and 41 scope exclusions out of 168 source files.

| File | Audit status |
| --- | --- |
| `src/browser-relay-auth-v2.ts` | Excluded: vendor browser relay |
| `src/chrome-devtools-auto-connect-patch.ts` | Excluded: vendor browser relay |
| `src/chrome-devtools-command.ts` | Excluded: vendor browser relay |
| `src/chrome-devtools-compat.ts` | Excluded: vendor browser relay |
| `src/chrome-devtools-relay-client.ts` | Excluded: vendor browser relay |
| `src/chrome-devtools-relay-discovery.ts` | Excluded: vendor browser relay |
| `src/chrome-devtools-relay-handoff.ts` | Excluded: vendor browser relay |
| `src/chrome-devtools-relay-proxy.ts` | Excluded: vendor browser relay |
| `src/chrome-devtools-relay.ts` | Excluded: vendor browser relay |
| `src/cli/adhoc-help.ts` | Complete read |
| `src/cli/adhoc-server.ts` | Complete read |
| `src/cli/ascii-slug.ts` | Complete read |
| `src/cli/auth-command.ts` | Complete read |
| `src/cli/call-argument-expression.ts` | Complete read |
| `src/cli/call-argument-values.ts` | Complete read |
| `src/cli/call-arguments.ts` | Complete read |
| `src/cli/call-command.ts` | Complete read |
| `src/cli/call-expression-parser.ts` | Complete read |
| `src/cli/call-help.ts` | Complete read |
| `src/cli/cli-factory.ts` | Complete read |
| `src/cli/command-inference.ts` | Complete read |
| `src/cli/config/add.ts` | Complete read |
| `src/cli/config/auth.ts` | Complete read |
| `src/cli/config/doctor.ts` | Complete read |
| `src/cli/config/get.ts` | Complete read |
| `src/cli/config/help.ts` | Complete read |
| `src/cli/config/import.ts` | Complete read |
| `src/cli/config/index.ts` | Complete read |
| `src/cli/config/list.ts` | Complete read |
| `src/cli/config/remove.ts` | Complete read |
| `src/cli/config/render.ts` | Complete read |
| `src/cli/config/shared.ts` | Complete read |
| `src/cli/config/types.ts` | Complete read |
| `src/cli/config-command.ts` | Complete read |
| `src/cli/daemon-command.ts` | Excluded: daemon/process owner |
| `src/cli/emit-ts-command.ts` | Complete read |
| `src/cli/emit-ts-templates.ts` | Complete read |
| `src/cli/ephemeral-flags.ts` | Complete read |
| `src/cli/ephemeral-target.ts` | Complete read |
| `src/cli/errors.ts` | Complete read |
| `src/cli/flag-utils.ts` | Complete read |
| `src/cli/generate/artifacts.ts` | Complete read |
| `src/cli/generate/definition.ts` | Complete read |
| `src/cli/generate/flag-parser.ts` | Complete read |
| `src/cli/generate/flags.ts` | Complete read |
| `src/cli/generate/fs-helpers.ts` | Complete read |
| `src/cli/generate/name-utils.ts` | Complete read |
| `src/cli/generate/output.ts` | Complete read |
| `src/cli/generate/runtime.ts` | Complete read |
| `src/cli/generate/server-utils.ts` | Complete read |
| `src/cli/generate/template-data.ts` | Complete read |
| `src/cli/generate/template-help.ts` | Complete read |
| `src/cli/generate/template.ts` | Complete read |
| `src/cli/generate/tool-selection.ts` | Complete read |
| `src/cli/generate/tools.ts` | Complete read |
| `src/cli/generate/types.ts` | Complete read |
| `src/cli/generate-cli-runner.ts` | Complete read |
| `src/cli/help-output.ts` | Complete read |
| `src/cli/http-utils.ts` | Complete read |
| `src/cli/identifier-helpers.ts` | Complete read |
| `src/cli/image-output.ts` | Complete read |
| `src/cli/inspect-cli-command.ts` | Complete read |
| `src/cli/json-output.ts` | Complete read |
| `src/cli/list-command.ts` | Complete read |
| `src/cli/list-detail-helpers.ts` | Complete read |
| `src/cli/list-doc-comments.ts` | Complete read |
| `src/cli/list-flags.ts` | Complete read |
| `src/cli/list-format.ts` | Complete read |
| `src/cli/list-output.ts` | Complete read |
| `src/cli/list-signature.ts` | Complete read |
| `src/cli/logger-context.ts` | Complete read |
| `src/cli/output-format.ts` | Complete read |
| `src/cli/output-utils.ts` | Complete read |
| `src/cli/path-utils.ts` | Complete read |
| `src/cli/record-command.ts` | Excluded: record/replay |
| `src/cli/record-replay-command.ts` | Excluded: record/replay |
| `src/cli/record-replay-env.ts` | Excluded: record/replay |
| `src/cli/replay-command.ts` | Excluded: record/replay |
| `src/cli/resource-command.ts` | Complete read |
| `src/cli/runtime-debug.ts` | Complete read |
| `src/cli/serve-command.ts` | Excluded: rehosting bridge |
| `src/cli/server-lookup.ts` | Complete read |
| `src/cli/terminal.ts` | Complete read |
| `src/cli/timeouts.ts` | Complete read |
| `src/cli/tool-cache.ts` | Complete read |
| `src/cli/transport-utils.ts` | Complete read |
| `src/cli/vault-command.ts` | Complete read |
| `src/cli-metadata.ts` | Complete read |
| `src/cli.ts` | Complete read |
| `src/config/imports/external.ts` | Complete read |
| `src/config/imports/paths-utils.ts` | Complete read |
| `src/config/imports/paths.ts` | Complete read |
| `src/config/imports/shared.ts` | Complete read |
| `src/config/path-discovery.ts` | Complete read |
| `src/config/read-config.ts` | Complete read |
| `src/config-imports.ts` | Complete read |
| `src/config-normalize.ts` | Complete read |
| `src/config-schema.ts` | Complete read |
| `src/config.ts` | Complete read |
| `src/daemon/broker.ts` | Excluded: daemon/process owner |
| `src/daemon/browser-owner.ts` | Excluded: daemon/process owner |
| `src/daemon/client.ts` | Excluded: daemon/process owner |
| `src/daemon/config-layers.ts` | Excluded: daemon/process owner |
| `src/daemon/connection-identity.ts` | Excluded: daemon/process owner |
| `src/daemon/definition-hash.ts` | Excluded: daemon/process owner |
| `src/daemon/host.ts` | Excluded: daemon/process owner |
| `src/daemon/idle-timer.ts` | Excluded: daemon/process owner |
| `src/daemon/launch.ts` | Excluded: daemon/process owner |
| `src/daemon/log-context.ts` | Excluded: daemon/process owner |
| `src/daemon/migration.ts` | Excluded: daemon/process owner |
| `src/daemon/paths.ts` | Excluded: daemon/process owner |
| `src/daemon/process-retirement.ts` | Excluded: daemon/process owner |
| `src/daemon/protocol.ts` | Excluded: daemon/process owner |
| `src/daemon/request-utils.ts` | Excluded: daemon/process owner |
| `src/daemon/runtime-wrapper.ts` | Excluded: daemon/process owner |
| `src/daemon/socket-rpc.ts` | Excluded: daemon/process owner |
| `src/daemon/startup-readiness.ts` | Excluded: daemon/process owner |
| `src/daemon/transport-authority.ts` | Excluded: daemon/process owner |
| `src/daemon/view-codec.ts` | Excluded: daemon/process owner |
| `src/definition-fields.ts` | Complete read |
| `src/env.ts` | Complete read |
| `src/error-classifier.ts` | Complete read |
| `src/fs-json.ts` | Complete read |
| `src/generate-cli.ts` | Complete read |
| `src/generated-daemon-runtime.ts` | Excluded: daemon/process owner |
| `src/index.ts` | Complete read |
| `src/lifecycle.ts` | Complete read |
| `src/logging.ts` | Complete read |
| `src/network-family-autoselection.ts` | Complete read |
| `src/oauth-browser-suppression.ts` | Complete read |
| `src/oauth-client-info.ts` | Complete read |
| `src/oauth-credential-validation.ts` | Complete read |
| `src/oauth-persistence-stores.ts` | Complete read |
| `src/oauth-persistence.ts` | Complete read |
| `src/oauth-redirect-uri.ts` | Complete read |
| `src/oauth-refresh-lock.ts` | Complete read |
| `src/oauth-token-generation.ts` | Complete read |
| `src/oauth-token-refresh.ts` | Complete read |
| `src/oauth-vault.ts` | Complete read |
| `src/oauth.ts` | Complete read |
| `src/paths.ts` | Complete read |
| `src/process-utils.ts` | Complete read |
| `src/result-utils.ts` | Complete read |
| `src/runtime/cached-auth.ts` | Complete read |
| `src/runtime/connection-cache.ts` | Complete read |
| `src/runtime/elicitation.ts` | Complete read |
| `src/runtime/environment.ts` | Complete read |
| `src/runtime/errors.ts` | Complete read |
| `src/runtime/http-transport.ts` | Complete read |
| `src/runtime/node-http-fetch.ts` | Complete read |
| `src/runtime/oauth.ts` | Complete read |
| `src/runtime/record-transport.ts` | Excluded: record/replay |
| `src/runtime/replay-transport.ts` | Excluded: record/replay |
| `src/runtime/stdio-transport.ts` | Excluded: local process transport |
| `src/runtime/transport-types.ts` | Complete read |
| `src/runtime/transport.ts` | Complete read |
| `src/runtime/utils.ts` | Complete read |
| `src/runtime-header-utils.ts` | Complete read |
| `src/runtime-oauth-support.ts` | Complete read |
| `src/runtime-process-utils.ts` | Excluded: local process transport |
| `src/runtime.ts` | Complete read |
| `src/schema-cache.ts` | Complete read |
| `src/sdk-stdio-logging.ts` | Excluded: local process transport |
| `src/serve.ts` | Complete read |
| `src/server-proxy.ts` | Complete read |
| `src/stable-json.ts` | Complete read |
| `src/tool-filters.ts` | Complete read |
| `src/version.ts` | Complete read |

## Test inventory

170 complete reads and 59 scope exclusions out of 229 test files.

| File | Audit status |
| --- | --- |
| `tests/adhoc-server.test.ts` | Complete read |
| `tests/browser-relay-auth-v2.test.ts` | Excluded: vendor browser relay |
| `tests/build-bun.test.ts` | Excluded: binary/publication route |
| `tests/call-arguments.test.ts` | Complete read |
| `tests/call-expression-parser.test.ts` | Complete read |
| `tests/chrome-devtools-command.test.ts` | Excluded: vendor browser relay |
| `tests/chrome-devtools-compat.test.ts` | Excluded: vendor browser relay |
| `tests/chrome-devtools-relay-client.test.ts` | Excluded: vendor browser relay |
| `tests/chrome-devtools-relay-discovery.test.ts` | Excluded: vendor browser relay |
| `tests/chrome-devtools-relay-handoff.test.ts` | Excluded: vendor browser relay |
| `tests/chrome-devtools-relay-proxy.test.ts` | Excluded: vendor browser relay |
| `tests/chrome-devtools-relay.test.ts` | Excluded: vendor browser relay |
| `tests/chrome-relay-fixture.test.ts` | Excluded: vendor browser relay |
| `tests/cli-auth-help.test.ts` | Complete read |
| `tests/cli-auth-retry.test.ts` | Complete read |
| `tests/cli-auth-stdio.test.ts` | Complete read |
| `tests/cli-auth.test.ts` | Complete read |
| `tests/cli-autorun.test.ts` | Complete read |
| `tests/cli-call-args.test.ts` | Complete read |
| `tests/cli-call-errors.test.ts` | Complete read |
| `tests/cli-call-execution.test.ts` | Complete read |
| `tests/cli-call-help.test.ts` | Complete read |
| `tests/cli-call-validation.test.ts` | Complete read |
| `tests/cli-command-inference.test.ts` | Complete read |
| `tests/cli-config-command.test.ts` | Complete read |
| `tests/cli-config-fallback.test.ts` | Complete read |
| `tests/cli-config-routing.test.ts` | Complete read |
| `tests/cli-daemon-fast-path.test.ts` | Excluded: daemon/process owner |
| `tests/cli-entrypoint-coverage.test.ts` | Complete read |
| `tests/cli-ephemeral-flags.test.ts` | Complete read |
| `tests/cli-flag-utils.test.ts` | Complete read |
| `tests/cli-force-exit-behavior.integration.test.ts` | Complete read |
| `tests/cli-generate-artifacts-rolldown-unavailable.test.ts` | Complete read |
| `tests/cli-generate-artifacts.test.ts` | Complete read |
| `tests/cli-generate-cli.integration.test.ts` | Complete read |
| `tests/cli-generate-runner.test.ts` | Complete read |
| `tests/cli-global-flags.test.ts` | Complete read |
| `tests/cli-help-shortcuts.test.ts` | Complete read |
| `tests/cli-http-selector.integration.test.ts` | Complete read |
| `tests/cli-idle-sse.integration.test.ts` | Complete read |
| `tests/cli-image-output.test.ts` | Complete read |
| `tests/cli-inspect-command.test.ts` | Complete read |
| `tests/cli-internals.test.ts` | Complete read |
| `tests/cli-list-classification.test.ts` | Complete read |
| `tests/cli-list-flags.test.ts` | Complete read |
| `tests/cli-list-formatting.test.ts` | Complete read |
| `tests/cli-list-help.test.ts` | Complete read |
| `tests/cli-list-json.test.ts` | Complete read |
| `tests/cli-list-modes.test.ts` | Complete read |
| `tests/cli-list-stdio-logs.test.ts` | Complete read |
| `tests/cli-list-verbose-e2e.test.ts` | Complete read |
| `tests/cli-metadata.test.ts` | Complete read |
| `tests/cli-oauth-timeout-flag.test.ts` | Complete read |
| `tests/cli-output-utils.test.ts` | Complete read |
| `tests/cli-parser-validation.test.ts` | Complete read |
| `tests/cli-regenerate.test.ts` | Complete read |
| `tests/cli-relay-timeouts.test.ts` | Complete read |
| `tests/cli-resource-command.test.ts` | Complete read |
| `tests/cli-serve-command.test.ts` | Excluded: rehosting bridge |
| `tests/cli-serve-runtime.test.ts` | Excluded: rehosting bridge |
| `tests/cli-stdout-pipe-truncation.integration.test.ts` | Complete read |
| `tests/cli-timeouts.test.ts` | Complete read |
| `tests/cli-vault-help.test.ts` | Complete read |
| `tests/cli-version.test.ts` | Complete read |
| `tests/config-add-dry-run.test.ts` | Complete read |
| `tests/config-add-flags.test.ts` | Complete read |
| `tests/config-add-imports.test.ts` | Complete read |
| `tests/config-add-persist.test.ts` | Complete read |
| `tests/config-add-scope-behavior.test.ts` | Complete read |
| `tests/config-add-scope.test.ts` | Complete read |
| `tests/config-add-sse.test.ts` | Complete read |
| `tests/config-add-validation.test.ts` | Complete read |
| `tests/config-command-string.test.ts` | Complete read |
| `tests/config-doctor.test.ts` | Complete read |
| `tests/config-get-json.test.ts` | Complete read |
| `tests/config-help-color.test.ts` | Complete read |
| `tests/config-help.test.ts` | Complete read |
| `tests/config-import-dedupe.test.ts` | Complete read |
| `tests/config-import-paths.test.ts` | Complete read |
| `tests/config-import.test.ts` | Complete read |
| `tests/config-imports-rich-entry.test.ts` | Complete read |
| `tests/config-imports-unit.test.ts` | Complete read |
| `tests/config-imports.test.ts` | Complete read |
| `tests/config-layer-paths.test.ts` | Complete read |
| `tests/config-layered.test.ts` | Complete read |
| `tests/config-list-text-footer.test.ts` | Complete read |
| `tests/config-list.test.ts` | Complete read |
| `tests/config-missing.test.ts` | Complete read |
| `tests/config-normalize-edge.test.ts` | Complete read |
| `tests/config-normalize.test.ts` | Complete read |
| `tests/config-preservation.test.ts` | Complete read |
| `tests/config-remove.test.ts` | Complete read |
| `tests/config-render.test.ts` | Complete read |
| `tests/config-resolution.test.ts` | Complete read |
| `tests/config-schema-file.test.ts` | Complete read |
| `tests/config-shared.test.ts` | Complete read |
| `tests/config-sources.test.ts` | Complete read |
| `tests/daemon-cli-command.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-client-config-stale.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-client-lifecycle.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-client-timeout.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-client-view-lifetime.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-client.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-config-layers.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-config-snapshot.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-directory-upgrade.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-elicitation.test.ts` | Complete read |
| `tests/daemon-host-idle-overflow.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-host.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-launch-process.integration.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-launch.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-liveness.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-log-context.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-request-utils.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-startup-readiness.test.ts` | Excluded: daemon/process owner |
| `tests/daemon-windows-directory.test.ts` | Excluded: daemon/process owner |
| `tests/daemon.integration.test.ts` | Excluded: daemon/process owner |
| `tests/definition-fields.test.ts` | Complete read |
| `tests/docs-html-utils.test.ts` | Complete read |
| `tests/e2e-fixture-servers.test.ts` | Complete read |
| `tests/emit-ts.test.ts` | Complete read |
| `tests/env-and-daemon-utils.test.ts` | Complete read |
| `tests/ephemeral-target.test.ts` | Complete read |
| `tests/error-classifier.test.ts` | Complete read |
| `tests/fixture-lifecycle.test.ts` | Complete read |
| `tests/fs-json.test.ts` | Complete read |
| `tests/generate-cli-helpers.test.ts` | Complete read |
| `tests/generate-cli-option-collisions.test.ts` | Complete read |
| `tests/generate-cli.test.ts` | Complete read |
| `tests/generate-definition.test.ts` | Complete read |
| `tests/generate-flags.test.ts` | Complete read |
| `tests/generate-fs-helpers.test.ts` | Complete read |
| `tests/generate-name-utils.test.ts` | Complete read |
| `tests/generated-daemon-runtime.test.ts` | Excluded: daemon/process owner |
| `tests/generator-flag-parser.test.ts` | Complete read |
| `tests/http-utils.test.ts` | Complete read |
| `tests/index-api.test.ts` | Complete read |
| `tests/json-output.test.ts` | Complete read |
| `tests/keep-alive-runtime.test.ts` | Excluded: daemon/process owner |
| `tests/lifecycle-overrides.test.ts` | Complete read |
| `tests/lifecycle.test.ts` | Complete read |
| `tests/list-detail-helpers.test.ts` | Complete read |
| `tests/list-format.test.ts` | Complete read |
| `tests/list-inline-stdio.test.ts` | Complete read |
| `tests/list-output.test.ts` | Complete read |
| `tests/live/deepwiki-live.test.ts` | Complete read |
| `tests/live/live-workflows.test.ts` | Complete read |
| `tests/live/protocol-era-conformance.test.ts` | Complete read |
| `tests/live/surface-conformance.test.ts` | Complete read |
| `tests/logging.test.ts` | Complete read |
| `tests/network-family-autoselection.test.ts` | Complete read |
| `tests/node-http-fetch.test.ts` | Complete read |
| `tests/oauth-bridge-get-post-concurrency.test.ts` | Complete read |
| `tests/oauth-callback.test.ts` | Complete read |
| `tests/oauth-clear-cache-jail.test.ts` | Complete read |
| `tests/oauth-client-info.test.ts` | Complete read |
| `tests/oauth-credential-validation.test.ts` | Complete read |
| `tests/oauth-normalized-redirect.test.ts` | Complete read |
| `tests/oauth-open-external-process.integration.test.ts` | Complete read |
| `tests/oauth-open-external.test.ts` | Complete read |
| `tests/oauth-persistence-stores.test.ts` | Complete read |
| `tests/oauth-persistence.test.ts` | Complete read |
| `tests/oauth-refresh-lock.test.ts` | Complete read |
| `tests/oauth-refresh-process.integration.test.ts` | Complete read |
| `tests/oauth-requested-scope.test.ts` | Complete read |
| `tests/oauth-session.test.ts` | Complete read |
| `tests/oauth-token-generation.test.ts` | Complete read |
| `tests/paths.test.ts` | Complete read |
| `tests/platform-branches.test.ts` | Complete read |
| `tests/process-retirement.integration.test.ts` | Excluded: daemon/process owner |
| `tests/process-retirement.test.ts` | Excluded: daemon/process owner |
| `tests/process-utils.test.ts` | Complete read |
| `tests/readme-claims.test.ts` | Complete read |
| `tests/record-replay-cli-close.test.ts` | Excluded: record/replay |
| `tests/record-replay-cli.test.ts` | Excluded: record/replay |
| `tests/record-replay.test.ts` | Excluded: record/replay |
| `tests/record-transport-errors.test.ts` | Excluded: record/replay |
| `tests/result-utils.test.ts` | Complete read |
| `tests/runtime-broker-authority.test.ts` | Excluded: daemon/process owner |
| `tests/runtime-cache-policy.test.ts` | Complete read |
| `tests/runtime-cache.test.ts` | Complete read |
| `tests/runtime-call-timeout.test.ts` | Complete read |
| `tests/runtime-chrome-relay-handoff.test.ts` | Excluded: daemon/process owner |
| `tests/runtime-compose.test.ts` | Complete read |
| `tests/runtime-debug.test.ts` | Complete read |
| `tests/runtime-elicitation.test.ts` | Complete read |
| `tests/runtime-error-reset.test.ts` | Complete read |
| `tests/runtime-header-utils.test.ts` | Complete read |
| `tests/runtime-inflight-close.test.ts` | Complete read |
| `tests/runtime-integration.test.ts` | Complete read |
| `tests/runtime-listtools-timeout.test.ts` | Complete read |
| `tests/runtime-oauth-connect.test.ts` | Complete read |
| `tests/runtime-oauth-detection.test.ts` | Complete read |
| `tests/runtime-oauth-timeout.test.ts` | Complete read |
| `tests/runtime-oauth-utils.test.ts` | Complete read |
| `tests/runtime-process-utils.test.ts` | Excluded: local process transport |
| `tests/runtime-stdio-close.test.ts` | Excluded: local process transport |
| `tests/runtime-transport.test.ts` | Complete read |
| `tests/runtime-utils.test.ts` | Complete read |
| `tests/runtime.test.ts` | Complete read |
| `tests/schema-cache.test.ts` | Complete read |
| `tests/serve-edge.test.ts` | Complete read |
| `tests/serve-handler-canonicalization.test.ts` | Complete read |
| `tests/serve-stream-errors.test.ts` | Complete read |
| `tests/serve.test.ts` | Complete read |
| `tests/server-proxy.test.ts` | Complete read |
| `tests/singleton-auth-context.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-broker.integration.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-chrome-launch.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-chrome-relay-recovery.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-chrome-relay.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-discovery.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-idle-overflow.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-idle.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-metadata-policy.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-migration.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-ownership.test.ts` | Excluded: daemon/process owner |
| `tests/singleton-recovery.test.ts` | Excluded: daemon/process owner |
| `tests/stable-json.test.ts` | Complete read |
| `tests/stdio-servers.integration.test.ts` | Excluded: local process transport |
| `tests/stdio-transport.test.ts` | Excluded: local process transport |
| `tests/template-cwd.test.ts` | Complete read |
| `tests/tool-cache.test.ts` | Complete read |
| `tests/tool-filters.test.ts` | Complete read |
| `tests/vault-cli.integration.test.ts` | Complete read |
| `tests/vault-command.test.ts` | Complete read |
| `tests/vault-validation.test.ts` | Complete read |
| `tests/verify-npm-publication.test.mjs` | Excluded: binary/publication route |
| `tests/version-consistency.test.ts` | Complete read |

## Supporting files and remaining gates

Protocol-era server fixtures, OAuth refresh-process fixtures, CLI list and
configuration fixtures are reconciled in the source map. General runtime/OAuth
fixture helpers, timing, isolated-home setup, private-directory/dist helpers,
test helpers, tool fixtures and ANSI fixtures have also received complete
reads. Local stdio/browser-launch/bundler fixtures are scope exclusions.
Supporting package/readme/config-data coverage is not inferred from importing
a fixture. Any additional supporting document needed by a later finding must
be read before counting that finding resolved.

There are no pending complete reads in the scoped source/test inventory.
Remaining work includes generated-tool scalar CLI/SDK policies, transport
cleanup/error precedence checks, acceptance reconciliation and the requested
fourteen-hour meaningful-work duration. This inventory does not close those
gates or claim remote delivery.
