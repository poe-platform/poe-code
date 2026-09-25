# Python LLM and shell capabilities — issue 1445

## Delivery contract

Implement the bundled Python library and parent-configured shell/subprocess subset,
qualify them against the shared JavaScript service and actual independently installed
Pyodide/workerd, verify the hosted consumer, and deliver required code to remote main.
Close only after every requirement has current evidence. Issues 1443 and 1444 retain
their own broader acceptance criteria. Release publication and poe2 adoption are
separate outcomes; full release completion is not required by the user.

## Current requirement evidence

| Requirement | Implementation and verification | Completion |
| --- | --- | --- |
| Importable typed Python module | Bundled `poe_llm`, immutable requests/results, exceptions; 14 deterministic Python cases | Verified by final independently installed package |
| Discovery, selection, prompt/system/messages/options/files and responses | Direct invocation JSON capability, canonical cwd path resolution, shared service validation, text/binary events | Focused provider/adapter tests and final package runtime pass |
| Customization and composition | Client defaults, prompt functions, request/response transforms, Python conversations; registered service templates, schema and optional embeddings | Focused pure-Python/shared-service tests pass |
| Shared provider/auth/billing ownership | Shared `createLlmService`; typed scalar options; poe2 uses existing catalog, model proxy and authorization transport | Actual consumer workerd test passed; hosted deployment pending |
| Async iteration, cleanup, cancellation and limits | Context managers, stream retirement, host deadlines, 128 KiB host ceilings, 16 KiB native JSON requests | Actual individual task cancellation aborts provider; early close and invocation cleanup pass |
| Canonical filesystem and no direct CLI routing | Host reads canonical attachments; direct JS service; shell uses parent invocation | Bash/Python attachment equivalence passes, including non-root cwd |
| Runtime distribution and public consumption | Modules installed with authenticated runtime; packed public package gate | Final independently installed candidate passed all 13 actual runtime checks |
| Executable launcher examples | Checked-in single-call and streaming `.py` scripts run through the actual launcher | All three shipped examples pass in final installed workerd |
| Literal argv and explicit scripts | Bundled `poe_shell`, bounded binary capture and pull streaming | Deterministic tests and actual workerd pass |
| Ordinary subprocess compatibility | Qualified stdlib `run`/`check_output`; input/cwd/env/text/encoding/check/timeouts; binary stdout/stderr | Actual rg, pipeline, failures, deadline and binary round-trip checks pass |
| Nested interpreter and cleanup bounds | Direct nested Python refusal, invocation-scope admission guard | Actual workerd refusal and shell lifetime tests pass |
| Hosted consumer/no callbacks/private files | Optional consumer qualification entry, authenticated disposable Worker lane, owned-resource cleanup and receipts | Actual consumer and authenticated cleanup gates pass locally; hosted run pending |
| Documentation/support matrix | Package LLM/shell docs and launcher examples | Implemented; final evidence update pending |
| Remote-main delivery | Dedicated issue branch; atomic commits, rebase delivery | Not pushed yet |
| Package publication | GitHub stable publication | Not yet recorded |
| poe2 adoption | Consumer code maintained in separate checkout and independently exercised | Not delivered yet |

## Verification routes

Use the maintained full `npm run build`, `npm test`, repository lint routes, and
`npm run typecheck --workspace=@poe-platform/safe-bash`. The raw safe-bash
`tsconfig.json` invocation also traverses historical fixtures and stricter foreign
workspace source; it is not the maintained qualification route.

The actual runtime gate is `packages/safe-bash/tests/integration/python-jspi.test.mjs`
with independently packed and installed safe-bash/safe-fs/safe-js packages. Consumer
qualification additionally sets `SAFE_BASH_PYTHON_HOSTED_CONSUMER` to poe2's
`projects/agent-tool-service/qualification/python-llm.ts` and records its exact
revision. The reusable `qualify-python-llm.yml` uses the established consumer DEV
Cloudflare credentials and lifecycle helpers, authenticates the exported modules,
runs actual consumer and shell checks, and removes only its owned Worker/bucket.
Credential-free receipts are retained as CI artifacts. Temporary local evidence
stays in owned `out/` and is purged after verification and delivery.
