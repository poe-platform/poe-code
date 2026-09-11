# Issue 722: injected LLM command pack

## Requested result

Implement [#722](https://github.com/poe-platform/poe-code/issues/722) as an explicit SafeBash plugin. The command owns shell argument parsing, sandbox input, model selection, and streamed output. Consumers inject providers and transport. Do not add an ambient network capability, credential store, interactive session, or poe-code CLI command.

Current-source inspection found no `src/commands/llm` implementation. The existing network pack exposes `HttpTransport`; use that maintained contract rather than inventing a second transport interface to match the issue's descriptive name.

## Ownership

- Command implementation: `src/commands/llm` core files and fake-provider unit tests.
- Reference providers: `src/commands/llm/providers` and fake-transport unit tests.
- Integration: public exports, browser build entries, maintained test inventory, real Shell consumer coverage.
- Root coordination: documentation, acceptance review, serialized broad checks, exact-file commit, push, remote-main verification, and release monitoring.

All paths above are inside `packages/safe-bash` unless described as root integration. Keep the command independent of provider names and endpoint choices. Each provider declares its models and accepted attachment/output types.

## Acceptance evidence to collect

| Requirement | Required verification |
| --- | --- |
| `createLlmCommands` and `llmCommands` | Public root and subpath imports; real Shell registration; one `llm` command; no default aggregate registration; collision refusal and explicit replacement |
| Provider/model registry | Multiple providers; id and alias routing; duplicate/ambiguous selection rejected at registration; default and unknown-model behavior |
| Prompt and flags | Argument-only, stdin-only, combined content/instruction; system; repeated untouched option values; option arity errors; quoted values and end-of-options |
| Attachments | Sandbox-only file reads; magic-byte MIME detection and extension fallback; explicit `--at`; repeat attachments; wildcard acceptance; refusal before provider call; bytes charged to shared input budgets |
| Text and binary output | Text chunks stream with final newline; raw binary without newline; pipes and file redirection preserve bytes; mixed responses rejected; output budgets and producer reuse/backpressure respected |
| Cancellation | Signal passed through; blocked input/provider/output cancellation; late rejection observed; acquired cooperative resources disposed; no timeout relaxation |
| OpenAI chat | Fake SSE response split across byte boundaries; request system/prompt/options and image data URI; delta content streaming; HTTP/protocol errors |
| OpenAI images | Generation and attachment edit routes; multipart bytes; configured options; decoded `b64_json`; bounded invalid/error responses |
| OpenAI videos | Create, pending-state polling, completion and binary download; input reference; terminal failure; abort during polling/body handling |
| ElevenLabs TTS | Configured model and voice override/default; missing voice error; audio format derived from output type; numeric settings serialized correctly; streamed bytes |
| ElevenLabs music | Configured model, prompt, length and instrumental fields; no attachments; binary output and format; failed HTTP response |
| Transport boundary | Injected transport only; no ambient credentials; explicit base URL; response disposal; no credential leakage through untrusted response URLs |
| Published surface | Maintained build, root/scoped packed Node and Bun consumers, browser bundle and execution, strict consumer types |
| Documentation | Pack README with all configuration/flags, provider contract, MIME and output behavior; link from SafeBash optional command list as explicitly requested in #722 |

## Validation and delivery

Start with focused failing tests for absent behavior. Use in-memory providers and fake transport fixtures; never query an LLM in unit tests. Register new canonical tests in the maintained integration inventory. Run focused tests while developing, then coordinate build, type, lint, broader tests, and packed consumers without competing source changes or CPU-heavy runs. Record actual command results and limitations here before delivery.

Manual QA uses a real Shell with deterministic injected providers to execute the issue's text, attachment, image/audio byte redirection, and pipeline patterns. Inspect command output, exit status, stored bytes, and a terminal screenshot of help/model listing where present. Real remote service acceptance is separate from fake-transport wire validation; do not claim it without executing it.

Push only a coherent, verified implementation. Track local commit, remote-main delivery, and each release result separately. Existing release monitoring for #662 remains active while this issue is developed, as authorized by the repository delivery instructions.

## Focused implementation evidence

- Core: 31 tests passed in the final focused run, covering registration, flags, stdin/attachment admission, binary/text output, MIME detection, and cancellation. Failing controls demonstrated missing implementation, over-limit provider admission, opaque iterator cleanup blocking abort, AAC/Matroska misclassification, inherited-property extension lookup, and literal `models` prompts being mistaken for the listing subcommand. Each was corrected before the passing run.
- Providers: 16 fake-transport tests passed across all five endpoint paths, including invalid output declarations and a response-adoption cancellation race that initially missed disposal. Strict scoped TypeScript checks passed.
- Public integration: the exported real Shell consumer failed before exports existed and passed afterward. The maintained integration inventory passed all 106 checks. Existing packed Node/Bun/browser/type fixtures now include the optional LLM routes.
- Independent review approved the input-budget interface, cancellation ownership fixes, MIME follow-ups, declared media output validation, and documented limitations. No live service acceptance is claimed.

These are focused results. Normal build, broader lint/tests, packed consumers, manual visual QA, commit, push, and release remain outstanding at this checkpoint.

## Integration validation checkpoint

The normal build and root type checks passed. SafeBash's broader type check initially resolved root Node 25 declarations because the installed workspace lacked its locked Node 22 declarations, Undici types, and tsx package. Restoring those exact lockfile packages with SHA-512 integrity verification made the unchanged check pass all 26 consumer groups. No source, lockfile, historical fixture, or strictness change was needed. The normal build passed again using the restored dependency profile.

Manual QA against the built entry verified model listing, combined stdin/instruction text, PNG attachment MIME detection, and byte-exact binary file redirection followed by base64. The terminal screenshot was inspected. These checks used deterministic injected providers and no live service requests.

Repository ESLint passed 10,775 configured files with zero errors and warnings before the final one-line literal-prompt correction; workflow lint passed afterward. The correction has two failing-then-passing real Shell regressions. Full maintained tests, final lint and artifact checks, commit, push, and release remain outstanding.

The first full `npm test` run passed the shared 22,465 tests, Python's 29 tests, SafeBash's 313 runner tests, and its 125 parallel tests, then reported a failure in the committed S3 HTTP export check. That check requires the current package and root manifests to match the selected Git revision. Both staged manifests differed from `HEAD`, while the lockfile matched. The run was stopped with SIGINT and confirmed to leave no owned processes; it is failed and incomplete, not a full-suite pass. A local candidate commit is needed before rerunning this unchanged archive gate. No fixture or assertion relaxation is justified. Push remains pending successful qualification of the committed candidate.

## Committed candidate qualification

Implementation commit `a46e034059bbe80f84070becaa6f7ff406ee6e05` passed the unchanged committed S3 export check and the complete maintained `npm test`, including native lifecycle scripts and posttest. Results: shared 22,465 passed and 2 skipped; Python 29 passed; SafeBash runner 313 passed, parallel phase 125 passed, serial phase 31,114 passed and 86 skipped; SafeJS 21,663 passed and 37 skipped; terminal 288 passed; posttest 2 passed. Skips are reported separately, not counted as passes. The process exited zero with no owned survivors and a clean checkout.

Final repository ESLint covered all 10,775 configured files with zero errors or warnings in 258.74 seconds. Root and SafeBash consumer type gates and workflow lint had already passed; the final code change was additionally covered by the complete unit run and packed consumer types.

The first packed-browser attempt exposed build ordering: the unit task's workspace build overwrote bundled `dist/core.browser.js` with raw TypeScript output. Export conditions were correct. Running the normal `npm run build` after tests restored the browser suffix artifacts; no source, fixture, or assertion change was needed. The subsequent packed qualification passed all 35 executed stages: root and scoped Node/Bun consumers, TypeScript consumers, browser bundling and execution without external imports, runtime and publication witnesses, CLI help, legacy compatibility, and filesystem-only consumers. Before/after tracked-source inventories matched and every owned process group was absent after its stage.

Final built-entry manual QA verified `llm models`, `llm -- models`, and `llm -m text models`; the latter two reached the injected provider as literal prompts. The terminal screenshot was inspected. Together with the earlier text, attachment, and binary-redirection checks, this completes local qualification. Providers were exercised with deterministic fake transports; no live service acceptance is claimed. Remote-main delivery and GitHub publication remain separate subsequent steps.
