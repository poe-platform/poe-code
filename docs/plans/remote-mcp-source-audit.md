# Remote MCP source and requirement audit

This records source coverage beyond the 121 closed-issue ledger in
`remote-mcp-safe-bash.md`. Upstream is pinned to
`e5450d49070b48ab988d74aaf060800a493e51bc`. A reviewed source file does not
imply that every dependent test has been examined. Pending entries remain open.

## Reviewed source groups

| Upstream source and tests | Applicable generic contract | Local implementation and evidence |
| --- | --- | --- |
| Complete `runtime.ts`, `server-proxy.ts`, `tests/server-proxy.test.ts` | Discovery policy must match execution policy; schema fields must retain ownership even when named args, disableOAuth or timeout. Exact tool names avoid proxy aliases. | `schema.ts`, `remote.ts`, `arguments.ts`, `commands.ts`; supplied schemas never rediscover. Native command regression retains eight execution-looking schema fields through both named and raw arguments. Default headless policy passes discovery/direct/artifact/resource routes on repeated 401s. |
| Complete `schema-cache.ts`, `tests/schema-cache.test.ts` | Persisted schema metadata must remain bound to the intended server; missing schemas cannot silently enable unvalidated calls. | Explicit digest-validated artifacts replace ambient cache lookup. Authoritative supplied empty/nonempty schemas and loud discovery errors are covered in schema/artifact tests and written-module QA. No HOME/XDG schema cache is inferred. |
| Complete `runtime/connection-cache.ts`; complete runtime-cache, runtime-cache-policy, runtime-error-reset and runtime-inflight-close tests | Failed/canceled work may only retire the connection it owns; replacement identities and authentication policies remain independent. | Independent operation-owned connections replace pooled runtime sessions. Parallel resource cancellation regression proves only the canceled session is deleted; sibling completes. OAuth identity/transaction tests cover shared credential persistence separately from transport ownership. |
| Complete `runtime/errors.ts`, `error-classifier.ts`, `tests/error-classifier.test.ts` | HTTP/OAuth/protocol status must stay distinguishable; strings containing 401 must not promote an arbitrary failure to OAuth or hide the primary cause. | Typed native HttpTransportError/McpError/OAuthError and safe CLI diagnostics replace text classification. Fallback accepts setup POST404/405 only; network/auth/rate-limit/server/protocol failures retain their cause. |
| Complete runtime-call-timeout and runtime-listtools-timeout tests | Deadlines include asynchronous setup/request work; timed-out input cannot continue later. | Native full-exchange deadline covers callback waits and continuation rounds. Four native and one command regression; built stalled-hook HTTP QA proves hook abortion, exit1 and zero continuation. Existing disposal regression proves synchronous timer cleanup. |
| Complete `runtime/http-transport.ts`, `runtime/node-http-fetch.ts`; complete runtime-transport and node-http-fetch tests | Preserve headers, cancellation, negotiated protocol, SSE cleanup and authoritative setup failures; custom fetch may need an independent receive-channel pool. | Native HTTP/SSE, explicit protocolVersion and host-injected fetch. Existing real HTTP1 adapter/recreated-artifact QA passes. No vendor hostname branches, implicit OAuth promotion or redirected credential requests. Host adapter owns pool topology and honors redirect:error and signals. Stdio/probe/Chrome relay cases are excluded. |
| Complete `runtime/elicitation.ts`, runtime/daemon elicitation tests | Form/URL requests require explicit host interaction, valid responses and cancellation; default noninteractive flow must settle promptly. | Public attributed onElicitationRequest hook, immediate decline and safe generic hint. Modern/legacy real HTTP QA, artifact reinjection, malformed request/response and stalled-hook cancellation/deadline regressions pass. No implicit browser or readline. |
| Complete `generate-cli.ts`, `cli/generate/definition.ts`, tools, flags, name-utils, tool-selection, template-data, template-help; complete tool-filter tests | Stable exact names, collision-safe options, preserved schemas/metadata and reproducible portable artifacts. | JSON/ESM data artifacts preserve exact tools, complete metadata and schema-derived flags; no native binary/bundler emitted. Explicit caller server names replace command/path/hostname inference. Full-schema validation replaces flat type guesses; defaults require --yes. Offline help/schema and unrelated-cwd module QA pass. Generator dependent test audit remains pending. |
| Complete `serve.ts` | Remote results and stream cleanup must remain intact; bridge-specific naming and keep-alive policy are separate concerns. | This library consumes remote MCPs and generates safe-bash commands. Rehosting a daemon-managed MCP server, stdio bridge and synthetic server__tool names are outside scope. Shared result/output/cancellation contracts have native command/resource evidence. Bridge tests remain pending for applicable shared edge cases. |

## Remaining source and test work

- Read generator template, artifact/fs helpers, output/runtime helpers, flag parser,
  CLI metadata and applicable generator/option-collision/definition tests.
- Read bridge edge/canonicalization/stream-error tests for reusable result and
  cancellation behavior, while retaining the explicit server-hosting exclusion.
- Check remaining remote runtime OAuth, transport composition and discovery tests
  against current native and library evidence; do not count name searches as reads.
- Inspect the schema graph/parser public boundaries and required consumer types.
- Reconcile all acceptance criteria against final implementation, tests, manual QA
  and documentation; identify any unsupported generic behavior explicitly.
- Continue meaningful implementation/audit work through the requested fourteen
  hours. Closed issue inventory coverage alone is not completion.

## Delivery state

Changes are local commits on main under the inherited task constraints. No push,
PR, remote-main verification, release or ready notification is claimed.
