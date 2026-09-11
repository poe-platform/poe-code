# Injected-provider `llm` command pack

An explicitly enabled SafeBash command for single-request text, image, video
and audio generation. Providers own querying and authentication; the command
parses arguments, resolves models, reads sandbox attachments and streams output.
It is separate from `agentCommands()` and is not a poe-code CLI command.
Neither the command nor the reference providers read environment variables,
store credentials, discover models remotely, or implicitly enable networking.

## Configuration and public exports

Import from `virtual-bash/commands/llm` in this workspace, or the equivalent
safe-bash package-root exports. The distributable package name is
`@poe-platform/safe-bash`; Browser/Worker command-subpath exports are available.
`createLlmCommands(options)` returns command definitions;
`llmCommands(options)` returns a plugin for `shell.use(...)`. Both accept:

| Option | Meaning |
| --- | --- |
| `providers` | Required readonly list of providers declaring models and `complete` |
| `defaultModel` | Optional model ID, alias, or qualified `provider/model` used when `-m` is omitted |
| `replace` | Optional boolean, default `false`; replace an already registered `llm` command, not model conflicts |

The command entry exports `LlmCommandsOptions`, `LlmProvider`, `LlmModel`, and
`LlmRequest`. Reference factories `createOpenAiProvider` and
`createElevenLabsProvider`, their `OpenAiModel`/`ElevenLabsModel` and
`OpenAiProviderOptions`/`ElevenLabsProviderOptions` types, and
`LlmProviderLimits` are also available through `commands/llm/providers`.
That subpath retains reexports of the canonical flat provider implementations.

This deterministic provider exercises a pipeline without a service request:

```ts
import { Shell, createMemoryFileSystem, agentCommands } from "virtual-bash";
import { llmCommands } from "virtual-bash/commands/llm";

const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(agentCommands())
  .use(llmCommands({
    defaultModel: "echo",
    providers: [{
      name: "example",
      models: [{ id: "echo" }],
      async *complete(request) { yield request.prompt; },
    }],
  }));
try {
  const result = await shell.exec("printf hello | llm | cat");
  if (result.exitCode !== 0) throw new Error(result.stderr);
  console.log(result.stdout);
} finally {
  await shell.dispose();
}
```

## Command arguments

| Syntax | Behavior |
| --- | --- |
| `llm [prompt]` | Prompt from arguments, stdin, or both; stdin content precedes the argument instruction, separated by two newlines |
| `-m, --model <id>` | Select a configured model ID, alias, or qualified `provider/model` |
| `-s, --system <text>` | Set the system prompt |
| `-o, --option <key> <value>` | Repeatable provider options; string values, last value for a repeated key wins |
| `-a, --attachment <path>` | Repeatable sandbox-file attachment; sniff MIME from bytes, then fall back to extension |
| `--at <path> <mimetype>` | Repeatable sandbox-file attachment with explicit MIME type |
| `-h, --help` | Show usage without requiring a model or calling a provider |
| `llm models` | List configured `provider/model` names, aliases, accepted attachment types, and output types without a provider request |
| `--` | End option parsing, including prompts beginning with `-` |

Value-taking flags also accept long equals forms and attached short values,
e.g. `--model=example/echo`, `-mecho`, `--option=temperature 0.5`, and
`-otemperature 0.5`. Options taking two values still require the second argument.
With neither `--model` nor `defaultModel`, the command exits 1 and requests a
model; it never silently selects the first provider. Unknown models exit 1 with
`Unknown model: <id>`. Duplicate model IDs or ambiguous aliases are registration
errors, including collisions with qualified names. Providers receive canonical
model IDs, not aliases or qualification prefixes.

Attachment MIME matching is case-insensitive and supports exact types and
category wildcards such as `image/*`, `audio/*`, and `video/*`. Undeclared or
unsupported types fail before querying with `Model <id> does not accept <mimetype>`.
Files are read only from the sandbox filesystem, never downloaded from URLs or
read from the implicit host filesystem. Sniffing is a bounded signature check,
not full media validation; unknown formats fall back to `application/octet-stream`.
Reference endpoints may impose further restrictions.

Text output streams as UTF-8 chunks followed by one newline. Binary output
streams unchanged without a newline. Use redirection or `stdoutBytes` for media;
decoding arbitrary bytes as `stdout` loses information. A provider cannot mix
string and byte chunks in one response. Streaming errors may leave partial
stdout or an already-written output file.

### Input and execution limits

Combined stdin and attachment bytes obey the shell's `maxInputBytes` allowance.
Custom hosts can supply `CommandContext.inputBudget` with `maxBytes` and
`check(totalBytes)`. This is a host context capability, not an `llmCommands` option.
The command also enforces a 64 MiB collected-input bound and a separate 64 MiB
argument-byte bound. Invalid UTF-8 prompt/input bytes fail rather than being
silently replaced. The work guard allows 1,000,000 argument/chunk/text-block
steps, yielding cooperatively every 256 steps. Shell cancellation, output, and
execution budgets still apply; provider limits below are additional bounds.

## Provider contract

```ts
interface LlmProvider {
  readonly name: string;
  readonly models: readonly LlmModel[];
  complete(request: LlmRequest): AsyncIterable<string | Uint8Array>;
}
interface LlmModel {
  readonly id: string;
  readonly aliases?: readonly string[];
  readonly attachmentTypes?: readonly string[];
  readonly outputType?: string;
}
interface LlmRequest {
  model: string;
  prompt: string;
  system?: string;
  attachments: readonly { mimeType: string; bytes: Uint8Array }[];
  options: Readonly<Record<string, string>>;
  signal: AbortSignal;
}
interface LlmCommandsOptions {
  readonly providers: readonly LlmProvider[];
  readonly defaultModel?: string;
  readonly replace?: boolean;
}
```

The common `outputType` default is `text/plain`; reference binary endpoints
require explicit output declarations. Provider code is trusted host JavaScript,
not sandboxed by SafeBash. Providers should honor `signal`, stream with
backpressure, and release resources on completion, failure, or cancellation.
Cancellation requests iterator cleanup and observes late rejections; it does
**not** await opaque injected iterator cleanup without a bound or promise its
completion. It cannot forcibly stop arbitrary provider work. Provider-owned
transport cleanup remains the provider's responsibility.

The command passes every option value unchanged as a string. Providers map
options to wire types and reject invalid values. Models/endpoints are supplied
by the application, not a built-in catalogue or model-name routing mechanism.

## Reference provider configuration

Both factories accept the following options:

| Option | Meaning |
| --- | --- |
| `transport` | Required injected `HttpTransport`, shared with the network command pack |
| `apiKey` | Required explicit service credential; never read from the environment |
| `models` | Required readonly model declarations, each with its provider-specific `endpoint` |
| `baseUrl` | Optional compatible HTTP(S) API root without credentials, query, or fragment |
| `limits` | Optional `Partial<LlmProviderLimits>`; defaults below |

`createFetchTransport({ fetch? })` supplies a transport but does **not** apply
an origin allowlist. Wrap it with authorization, such as
`createOriginAuthorizer`, when required. Custom transports must enforce their
own authorization and redirect policy. Reference providers do not follow HTTP
redirects or fetch service-returned image URLs. All network access uses the
supplied transport; a compatible base URL does not guarantee endpoint/model
support by that service or account.

### OpenAI-compatible services

`createOpenAiProvider(options)` uses bearer authentication and defaults
`baseUrl` to `https://api.openai.com/v1`. Compatible API roots, including Poe,
can be configured explicitly. `OpenAiModel` adds the required
`endpoint: "chat" | "images" | "videos"` to the common model fields.

| Endpoint | Request and response |
| --- | --- |
| `chat` | Streams `/chat/completions` content deltas; system messages and image attachments encoded as base64 data-URI `image_url` parts |
| `images` | Uses `/images/generations`, or multipart `/images/edits` with images; decodes one `b64_json` image; multiple images, download URLs, and image event streaming are unsupported |
| `videos` | Creates a multipart `/videos` job, polls status, then streams `/videos/{id}/content`; at most one image `input_reference` |

Only chat accepts a system prompt. Chat output defaults to `text/plain` or can
be another `text/*` type. Images require `image/png`, `image/jpeg`, or
`image/webp`; videos require `video/mp4`. Image `output_format` is derived
from the declaration; a conflicting option is rejected before the request.
Image attachment MIME matching follows the command's case-insensitive rules.

For JSON chat requests, numeric fields are `temperature`, `top_p`,
`frequency_penalty`, `presence_penalty`, `max_tokens`,
`max_completion_tokens`, `n`, `seed`, and `top_logprobs`; boolean fields
are `store`, `parallel_tool_calls`, and `logprobs`. Image numeric fields are
`n`, `output_compression`, and `partial_images`. Invalid numbers,
fractional integer fields, unsafe integers, and invalid booleans fail before
transport invocation. Other fields, including `size`, `quality`,
`background`, and unknown compatible-endpoint fields, remain strings;
multipart fields, including video `seconds`, remain strings. Provider-controlled
request fields cannot be overridden by options.

### ElevenLabs

`createElevenLabsProvider(options)` uses `xi-api-key` authentication and
defaults `baseUrl` to `https://api.elevenlabs.io`. `ElevenLabsModel` adds
`endpoint: "tts" | "music"` and optional `defaultVoiceId` for TTS.

| Endpoint | Request and response |
| --- | --- |
| `tts` | Streams `/v1/text-to-speech/{voice_id}` with the selected `model_id`; `-o voice_id` overrides `defaultVoiceId`, and missing both is an error; remaining options become `voice_settings` |
| `music` | Streams `/v1/music` with the prompt, selected `model_id`, and request options |

Neither endpoint accepts attachments or a system prompt. TTS numeric options
are `stability`, `similarity_boost`, `style`, and `speed`;
`use_speaker_boost` is boolean. Music integer options are `music_length_ms`
and `seed`; boolean options are `force_instrumental`,
`respect_sections_durations`, `store_for_inpainting`, and `sign_with_c2pa`.
Boolean values must be `true` or `false`; other options remain strings.

An explicit supported `outputType` is required; omission does **not** default
to audio. The provider derives the `output_format` query parameter from it:

| Model `outputType` | Service format |
| --- | --- |
| `audio/mpeg` | `mp3_44100_128` |
| `audio/wav`, `audio/x-wav` | `wav_44100` (TTS only) |
| `audio/pcm` | `pcm_44100` |
| `audio/ogg`, `audio/opus` | `opus_48000_128` |
| `audio/basic` | `ulaw_8000` |

Unsupported output types and conflicting `output_format` options are rejected.
Format lookup uses the case-insensitive MIME base type; parameters and the
consumer's declared output type are preserved in model metadata.

### Provider limits

Both factories accept `limits: Partial<LlmProviderLimits>`:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxRequestBytes` | 64 MiB | Maximum encoded request body |
| `maxResponseBytes` | 64 MiB | Maximum bytes in each response body |
| `maxEventBytes` | 1 MiB | Maximum buffered chat event |
| `maxPolls` | 120 | Maximum video status polls |
| `pollIntervalMs` | 1,000 | Delay in milliseconds between video status polls |

Limits must be safe integers. Byte limits must be positive; polling count and
interval may be zero. JSON image responses require bounded buffering before
base64 decoding; audio and video content stream directly. Deterministic fake
transports exercise unit and packed-consumer checks, not live service requests.

With matching models/aliases configured, ordinary shell composition works:

```sh
cat notes.txt | llm 'summarize in three bullets'
llm -m gpt-image-1 'a watercolor fox' -o size 1024x1024 > fox.png
llm -m gpt-image-1 -a fox.png 'give the fox a red scarf' > fox-scarf.png
llm -m sora-2 -a fox-scarf.png 'slow pan' -o seconds 8 > fox.mp4
llm -a fox.png 'one sentence caption' | llm -m tts > caption.mp3
llm -m music 'lo-fi jazz loop' -o music_length_ms 30000 > loop.mp3
llm -m music 'cinematic strings' -o force_instrumental true > score.mp3
llm -m gpt-image-1 'a fox' | base64
```

URL attachments, key management, interactive chat, logging/history databases,
model/plugin installation, templates, embeddings, and conversation continuation
are outside this pack.
