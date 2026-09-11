# Issue 722: injected-provider llm command pack

## Scope

Add the explicit `llm` safe-bash command pack, without changing the default
agent command inventory or adding a poe-code CLI command. Export the command
factory, plugin, provider contracts and two reference providers through both
the package root and the portable command subpath.

## Implementation and acceptance

- Core: model/alias lookup and registration conflicts; argument and stdin
  composition; system/options; sandbox-only attachments with MIME detection,
  model capability checks and shared input accounting; streaming text/binary
  output; cancellation, backpressure and existing output limits.
- OpenAI: configured chat, image generation/edit and video job endpoints;
  streaming SSE, multipart attachments, polling and binary downloads.
- ElevenLabs: configured TTS/music endpoints; voice selection, output formats,
  option conversion and streaming audio.
- Integration: explicit exports and browser entry; command and provider docs;
  fake-provider/fake-transport tests, in-memory pipeline/redirection tests,
  public consumer checks and independent implementation review.

## Repository compatibility

The existing injected network interface is named `HttpTransport` and
`createFetchTransport` accepts `{ fetch? }`, not an authorization callback.
Use that maintained interface rather than introducing a competing transport.
Consumers enforce authorization in their injected transport; reference
providers do not follow redirects or access ambient credentials.

Tests must run without live LLM/network calls or disk fixture creation. Report
focused validation separately from any full repository or service validation.
No commit, push or release is part of the implementation request.

## Review and verification

- TDD covers the command, both reference transports and public exports.
- Independent review reproduced and fixed split UTF-16 surrogate output,
  Ogg Theora/EBML MIME classification and transport acquisition cleanup.
- Shell input-limit regressions require cumulative stdin/attachment admission,
  without charging argument prompts against a zero-byte input allowance.
- Full `npm run build` passes, including workspace builds and browser bundles.
- All 162 focused LLM tests, 40 browser/bundle tests and 313 maintained runner
  tests pass. Built Node root/subpath imports also pass an in-memory Unicode,
  binary-redirection and multi-model pipeline check.
- Maintained safe-bash typechecking passes source/tests and 26 current consumer
  groups; root type lint and full guarded ESLint pass without warnings.
- Help, model listing and unknown-model diagnostics were rendered and visually
  inspected using `terminal-png` (`/tmp/poe-722-llm.png`). No screenshot test added.
- Validation uses fake providers/transports, never a live LLM. Sandbox-blocked
  subprocess checks were rerun with approval; shared-artifact build/test work
  was sequenced before the final package-suite run.
- The complete 820-file package run reports 31,338 passes, 21 failures and
  63 skips. Twenty failures share a 45-second public-snapshot build timeout:
  the default `/tmp` contains over 53,000 entries. All 20 pass unchanged when
  rerun with `TMPDIR=$PWD/out/issue-722-tmp`; timeout limits were not relaxed
  and unrelated temporary files were not deleted.
- The remaining S3 committed-archive check was reproduced independently. It
  refuses the uncommitted package export change with `Peer binding requires
  the selected committed package metadata`, before any verification step.
  This gate needs a committed candidate and matching peer artifact; it was
  neither bypassed nor counted as passing. No commit was authorized or made.

## Requirement-by-requirement completion audit

| Issue requirement | Current evidence |
| --- | --- |
| `createLlmCommands`, `llmCommands`, `providers`, `defaultModel`, `replace`; register only `llm` | `types.ts` and `command.ts`; command factory, replacement and opt-in export tests. |
| Cross-provider IDs and aliases, duplicate-ID registration error, canonical request model, exact unknown-model diagnostic | Model lookup preflight tests, multi-provider routing tests and unknown-model stderr assertion. |
| Argument/stdin prompts, content before instruction, `-m`, `-s`, repeated `-o` with unchanged string values | CLI parsing tests assert complete provider requests, including string precision and prototype-named option keys. |
| Repeated sandbox `-a` and explicit `--at`, MIME sniffing/fallback, declared exact and wildcard types, rejection before query | VFS attachment tests, MIME review tests, unsupported-type/URL/missing-file tests and reference-provider case/parameter acceptance regressions. |
| Attachment input budgets, including combined stdin and repeated files | Real-shell configured-limit tests, zero-byte allowance tests and cumulative direct-host admission tests. |
| `llm models` displays provider/model, aliases, attachment types and output type | Exact listing assertions and inspected terminal rendering. |
| Incremental UTF-8 plus newline; unchanged binary output without newline; mixed chunks fail | Byte-exact output tests, surrogate-split review, backpressure tests, Node/browser pipelines and VFS redirects. |
| Shell cancellation, output limits and cooperative resource cleanup | Pending-read/acquisition/write tests, output-boundary tests, reference transport-disposal tests and native-cleanup rerun. |
| OpenAI configured chat/images/videos, image data URIs, edit multipart, job polling/content download, injected transport and custom base URL | Fixed-byte fake-transport request assertions, SSE boundary/error tests, video polling/abort tests and browser transport consumer. |
| ElevenLabs configured TTS/music, voice option/default/error, output format, voice settings/music fields, streamed bytes, no music attachments | Fake-transport route/body/format tests, direct and model-declaration attachment rejection, browser transport consumer. |
| Exported provider contract, Node/browser/root/subpath packaging, README with all options, safe-bash README link | Export tests, build output, strict typechecks, browser factory identity tests, pack README and parent command table. |
| No built-in model catalog, command provider branching, ambient credentials, direct network, key/history/chat/template/install commands or poe-code CLI registration | Source inspection of command and reference-provider modules; no default aggregate registration or CLI wiring changes. |
| Committed-archive verification of the changed package | Not proven: the current verifier explicitly requires package and root metadata to equal the selected Git revision. A commit needs user authorization; replacing this guard with a working-tree check would not be equivalent evidence. |

### Follow-up provider acceptance audit

The CLI-to-provider audit reproduced mismatches hidden by the original isolated
tests: OpenAI rejected uppercase image MIME types already admitted by the
command, ElevenLabs format lookup rejected equivalent MIME spellings, and
OpenAI numeric JSON options were encoded as strings. The reference providers
now reuse MIME admission/normalization and serialize their documented numeric
fields according to the endpoint schema. Model identities remain declarative;
the command's option values, unknown wire options and multipart fields stay
unchanged. All 212 focused tests pass, including the new acceptance cases and
invalid-numeric admission cases. The browser reference-provider test also covers
uppercase `--at` and numeric `temperature` end to end.

After those fixes, the full workspace build, all 40 browser/bundle tests, the
313-test runner suite, root type lint, the maintained 26-group package
typecheck, and full guarded ESLint were rerun successfully. A built Node
public-root/subpath consumer also verifies uppercase MIME, numeric request
serialization, ElevenLabs format lookup and binary VFS pipelines. The
committed-metadata prerequisite remains unchanged and is the only outstanding
qualification gate; no commit, push, guard waiver or timeout increase was made.
