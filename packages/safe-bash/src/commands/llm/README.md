# Injected-provider `llm` command pack

An explicitly enabled safe-bash command for single-request text, image, video
and audio generation. Providers own querying and authentication; the command
only parses arguments, resolves models, reads sandbox attachments and streams
output. It is not a poe-code CLI command and is not included in `agentCommands()`.

## Wiring

Import from `virtual-bash/commands/llm` in this workspace, or use the equivalent
exports from the safe-bash package root. Browser/Worker command-subpath exports
are available as well. The public distributable uses the
`@poe-platform/safe-bash` package name.

```ts
import {
  Shell, agentCommands, createMemoryFileSystem,
  createFetchTransport, createOriginAuthorizer,
  type HttpTransport,
} from "virtual-bash";
import {
  llmCommands, createOpenAiProvider, createElevenLabsProvider,
} from "virtual-bash/commands/llm";

const fetchTransport = createFetchTransport();
const authorize = createOriginAuthorizer([
  "https://api.openai.com", "https://api.elevenlabs.io",
]);
const transport: HttpTransport = async request => {
  const allowed = await authorize({
    url: request.url, method: request.method, attempt: 0,
    signal: request.signal,
  });
  if (!allowed) throw new Error("LLM request origin denied");
  return fetchTransport(request);
};

const openai = createOpenAiProvider({
  transport, apiKey: "consumer-supplied-openai-key",
  models: [
    { id: "gpt-4.1", aliases: ["4.1"], endpoint: "chat", attachmentTypes: ["image/*"] },
    { id: "gpt-image-1", endpoint: "images", attachmentTypes: ["image/*"], outputType: "image/png" },
    { id: "sora-2", endpoint: "videos", attachmentTypes: ["image/*"], outputType: "video/mp4" },
  ],
});
const elevenlabs = createElevenLabsProvider({
  transport, apiKey: "consumer-supplied-elevenlabs-key",
  models: [
    { id: "eleven_multilingual_v2", aliases: ["tts"], endpoint: "tts", outputType: "audio/mpeg", defaultVoiceId: "JBFqnCBsd6RMkjVDRZzb" },
    { id: "music_v1", aliases: ["music"], endpoint: "music", outputType: "audio/mpeg" },
  ],
});
const shell = new Shell({ fs: createMemoryFileSystem() })
  .use(agentCommands())
  .use(llmCommands({ providers: [openai, elevenlabs], defaultModel: "gpt-4.1" }));
try {
  await shell.exec("llm 'a watercolor fox' -m gpt-image-1 > fox.png");
} finally {
  await shell.dispose();
}
```

`HttpTransport` is the same injected interface used by the network pack.
`createFetchTransport({ fetch? })` itself does **not** enforce an origin allowlist;
the example wraps it explicitly. Reference providers do not follow redirects.
An injected custom transport must enforce its own authorization and redirect
policy. Neither the command nor the providers read environment variables or
store credentials. Network access is only through the supplied transport.

## Command options

| Syntax | Behavior |
| --- | --- |
| `llm [prompt]` | Prompt from arguments, stdin, or both. Piped content comes before the argument instruction. |
| `-m, --model <id>` | Resolve a configured model ID or alias across all providers; otherwise use `defaultModel`. |
| `-s, --system <text>` | Supply the system prompt. |
| `-o, --option <key> <value>` | Repeatable provider options. The command preserves string values; later values replace earlier values for the same key. |
| `-a, --attachment <path>` | Repeatable sandbox-file attachment; sniff MIME from bytes, then fall back to its extension. |
| `--at <path> <mimetype>` | Repeatable sandbox-file attachment with an explicit MIME type. |
| `--` | End option parsing, including prompts beginning with `-`. |
| `-h, --help` | Show usage without requiring a model or calling a provider. |
| `llm models` | List `provider/model`, aliases, accepted attachment types and output type. No provider request is made. |

Unknown models exit 1 with `Unknown model: <id>` on stderr. Unsupported
attachments exit 1 with `Model <id> does not accept <mimetype>` before querying.
Attachments are never downloaded from URLs and never read from the implicit
host filesystem. Exact MIME types and category wildcards such as `image/*`,
`video/*` and `audio/*` are supported. Undeclared attachment types are rejected.
Unrecognized file formats fall back to `application/octet-stream`.
With neither `--model` nor `defaultModel`, the command exits 1 and asks for a
model; it never silently selects the first configured provider. Qualified
`provider/model` IDs can also be used with `--model`.

Text models write UTF-8 chunks as received and append one newline. Binary
models write unchanged bytes without a newline. Declared output type defaults
to `text/plain`; a provider cannot mix string and binary chunks in one response.
A streaming error can leave a partial output file or already-written stdout.
Stdin and attachment bytes together obey the shell's configured `maxInputBytes`
(exposed to custom hosts as `CommandContext.inputByteLimit`). Arguments, stdin,
attachments and the two-newline content/instruction separator also share the
existing 32 MiB command buffer ceiling. Output uses the shell's existing output
budget and backpressure. The shell abort signal
is forwarded to providers and filesystem reads.
Long-running media jobs may need larger shell `maxWallClockMs` and
`maxOutputBytes` limits and filesystem file-size limits. The providers never
relax these limits; the OpenAI video adapter polls at ten-second intervals.

```sh
cat notes.md | llm 'turn these into a changelog'
llm -a photo.jpg 'what is in this picture'
llm -m gpt-image-1 'a watercolor fox' -o size 1024x1024 > fox.png
llm -m gpt-image-1 -a fox.png 'give the fox a red scarf' > fox-scarf.png
llm -m sora-2 -a fox-scarf.png 'slow pan, gentle wind' -o seconds 8 > fox.mp4
cat script.txt | llm -m tts > narration.mp3
llm -a fox.png 'one sentence caption' | llm -m tts > caption.mp3
llm -m music 'lo-fi jazz loop' -o music_length_ms 30000 > loop.mp3
llm -m music 'cinematic strings' -o force_instrumental true > score.mp3
llm -m gpt-image-1 'a fox' | base64
```

## Provider contract and pack configuration

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
  providers: readonly LlmProvider[];
  defaultModel?: string;
  replace?: boolean;
}
```

`createLlmCommands(options)` returns the single `llm` command definition;
`llmCommands(options)` installs it as a shell plugin. Duplicate model IDs and
ambiguous aliases are registration errors. Providers receive the canonical
model ID, not the requested alias. `replace` defaults to false and controls
replacement of an already registered `llm` command, not model conflicts.

## Reference provider configuration

Both factories require `transport`, `apiKey` and `models`; `baseUrl` is optional.
Every model declares the common fields above plus its provider-specific
`endpoint`. There is no built-in model catalogue or model-name routing.

### OpenAI

`createOpenAiProvider({ transport, apiKey, baseUrl?, models })` uses bearer
authentication and defaults to `https://api.openai.com/v1`. Set `baseUrl` to an
OpenAI-compatible API root, including Poe, and configure the models/endpoints
that service actually supports.

- `endpoint: "chat"`: streams `/chat/completions` content deltas. System text
  becomes a system message; image attachments become base64 `image_url` parts.
- `endpoint: "images"`: uses `/images/generations`, or multipart
  `/images/edits` when images are attached, and decodes `b64_json` into bytes.
  Options such as `size`, `quality` and `background` become request fields.
- `endpoint: "videos"`: creates a multipart `/videos` job, polls its status
  until completed, then streams `/videos/{id}/content`. One image can be sent
  as `input_reference`; options such as `seconds` and `size` become fields.

The command still passes every option value to `complete()` as a string. For
OpenAI JSON requests, the reference provider converts the documented numeric
fields: chat `temperature`, `top_p`, `frequency_penalty`, `presence_penalty`,
`max_tokens`, `max_completion_tokens`, `n`, `seed`, and `top_logprobs`; image
generation `n`, `output_compression`, and `partial_images`. Invalid numbers,
fractional integer fields and unsafe integers fail before the transport is
called. Other options remain strings, including `size`, `quality`, `background`
and unknown compatible-endpoint fields. Multipart fields remain strings.
Image attachment MIME matching follows the command's case-insensitive rules.

### ElevenLabs

`createElevenLabsProvider({ transport, apiKey, baseUrl?, models })` uses
`xi-api-key` authentication and defaults to `https://api.elevenlabs.io`.

- `endpoint: "tts"`: streams `/v1/text-to-speech/{voice_id}`, with the selected
  model as `model_id`. `-o voice_id` overrides the model's optional
  `defaultVoiceId`; a missing voice is an error. Remaining options become
  `voice_settings` fields, including `stability`, `similarity_boost` and `speed`.
- `endpoint: "music"`: streams `/v1/music`, with `prompt` and the selected
  `model_id`. Options such as `music_length_ms` and `force_instrumental` become
  request fields. Attachments are not supported.
- `output_format` is derived from each model's declared `outputType`.
  Numeric and boolean option strings are converted for the ElevenLabs API.

ElevenLabs defaults an omitted `outputType` to `audio/mpeg`. Formats are
`audio/mpeg` → `mp3_44100_128`, `audio/wav` or `audio/x-wav` → `wav_44100`
(TTS only), `audio/pcm` → `pcm_44100`, `audio/basic` → `ulaw_8000`, and
`audio/opus` → `opus_48000_128`. Unsupported output types fail during provider
configuration. TTS also accepts no attachments.
Format lookup uses the case-insensitive MIME base type; MIME parameters and
the consumer's declared output type are preserved in model metadata.

These adapters implement the configured endpoints, not an assertion that a
particular service/account supports a named model or attachment format. There
is no key management, interactive chat, history database, templates, embeddings,
conversation continuation, or plugin installation command.
