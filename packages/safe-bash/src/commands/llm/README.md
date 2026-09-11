# LLM command pack

`llmCommands` adds one optional `llm` command to a SafeBash shell. Providers are injected by the application; the command does not load credentials, discover models remotely, or enable networking itself.

## Configuration

`createLlmCommands(options)` returns command definitions. `llmCommands(options)` returns a plugin for `shell.use(...)`. Both accept:

| Option | Meaning |
| --- | --- |
| `providers` | Required readonly list of providers, each declaring its models and a `complete` function |
| `defaultModel` | Optional model id or alias used when `-m` is omitted |
| `replace` | Optional boolean, default `false`; allow intentional replacement of an already registered `llm` command |

The pack reads no environment variables. Authentication and transport configuration belong to the injected providers. It is separate from `agentCommands()` and is not a poe-code CLI command.

For example, this deterministic provider exercises a text pipeline without a service request:

```ts
import { Shell, MemoryFileSystem, agentCommands, llmCommands } from "@poe-platform/safe-bash";

const shell = new Shell({ fs: new MemoryFileSystem() })
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
  console.log(result.stdout); // hello, followed by a newline
} finally {
  await shell.dispose();
}
```

## Command arguments

| Argument | Behavior |
| --- | --- |
| `llm [prompt]` | Read the prompt from arguments, stdin, or both; with both, stdin supplies content and arguments supply the instruction |
| `-m`, `--model <id>` | Select a configured model by id or alias |
| `-s`, `--system <text>` | Set the system prompt |
| `-o`, `--option <key> <value>` | Repeatable provider options; values reach the provider as strings; the last value for a repeated key wins |
| `-a`, `--attachment <path>` | Read a file from the sandbox filesystem; detect MIME type from its bytes, with filename extension fallback |
| `--at <path> <mimetype>` | Read a sandbox file with an explicit MIME type |
| `llm models` | List configured `provider/model` names, aliases, accepted attachment types, and output types |
| `--` | End option parsing |

Attachments can be repeated. Models declare exact MIME types or wildcards such as `image/*`, `audio/*`, and `video/*`. A refused attachment fails before querying the provider. URL attachments, key storage, model installation, logging, templates, embeddings, and conversation continuation are outside this pack.

Text output streams as UTF-8 chunks followed by a newline. Binary output streams unchanged, without a trailing newline. Use shell redirection or `stdoutBytes` for binary results; decoding arbitrary media as `stdout` loses information. A provider cannot mix string and byte chunks in one response. The shell's abort signal and output budget apply to execution.

The command checks combined stdin and attachment bytes against the shell's `maxInputBytes` allowance. It also bounds collected input to 64 MiB and argument bytes separately to 64 MiB. Invalid UTF-8 prompt/input bytes fail instead of being silently replaced. Its work guard permits 1,000,000 argument/chunk/text-block steps, with cooperative yielding every 256 steps; streamed output remains subject to the shell output budget.

MIME detection is a bounded signature check with extension fallback, not full media validation. `--at` lets the caller declare a type explicitly. Accepted types come from the selected model; the reference providers can impose additional restrictions required by their service endpoints.

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
  readonly outputType?: string; // defaults to text/plain
}

interface LlmRequest {
  model: string;
  prompt: string;
  system?: string;
  attachments: readonly { mimeType: string; bytes: Uint8Array }[];
  options: Readonly<Record<string, string>>;
  signal: AbortSignal;
}
```

Model ids and aliases must resolve unambiguously across the provider list. The request contains the selected model's canonical id. Providers should honor `signal`, stream with backpressure, and release acquired resources when a response finishes or is canceled. Injected provider code is trusted host code; SafeBash does not sandbox that JavaScript or grant it additional permissions.

Cancellation requests iterator cleanup and observes late rejections. It cannot force arbitrary provider work to stop or promise completion of an opaque iterator's cleanup. Provider implementations must release their own acquired resources when the signal aborts.

The command passes option strings through untouched. A provider maps them to its service's wire types and rejects invalid values. Models and endpoint choices are application configuration, not a built-in list of service model names.

## Reference providers

The public factories are `createOpenAiProvider(options)` and `createElevenLabsProvider(options)`, also available from the `commands/llm/providers` subpath. Both require an injected `HttpTransport`, `apiKey`, and `models`. Optional `baseUrl` selects a compatible service; optional `limits` bounds provider-side buffering and polling. They read no environment variables: the application supplies any credentials explicitly.

`HttpTransport` is the same transport contract used by the network command pack. `createFetchTransport()` supplies an implementation, but does not itself apply an origin allowlist. Supply an authorized transport when the application needs that policy. Reference providers do not follow HTTP redirects or fetch image URLs returned by a service.

### OpenAI-compatible services

`baseUrl` defaults to `https://api.openai.com/v1`. Each model adds `endpoint: "chat" | "images" | "videos"` to the common model declaration. Specify the actual model id and accepted attachment/output types for your service.

| Endpoint | Request and response |
| --- | --- |
| `chat` | Streams `/chat/completions` delta content. Supports the system prompt and image attachments encoded as data URIs. |
| `images` | Uses `/images/generations`, or multipart `/images/edits` with image attachments. Decodes one `b64_json` image response; multiple images, returned download URLs, and image event streaming are unsupported. |
| `videos` | Creates a multipart `/videos` job, polls until complete, and streams `/videos/{id}/content`. Supports at most one image `input_reference`. |

Image and video endpoints do not accept a system prompt. Fields such as `size`, `quality`, `background`, and video `seconds` pass through to the service. The provider converts known numeric and boolean fields to their wire types and rejects invalid values. A compatible base URL does not guarantee that the service implements every endpoint or model.

Image models must declare `image/png`, `image/jpeg`, or `image/webp`; video models must declare `video/mp4`. Chat models use the common `text/plain` default or another `text/*` type. Image `output_format` is derived from the declaration; a conflicting option is rejected before the request.

### ElevenLabs

`baseUrl` defaults to `https://api.elevenlabs.io`. Each model adds `endpoint: "tts" | "music"`. TTS models may also supply `defaultVoiceId`.

| Endpoint | Request and response |
| --- | --- |
| `tts` | Streams `/v1/text-to-speech/{voice_id}` using the selected `model_id`. `-o voice_id` overrides `defaultVoiceId`; missing both is an error. Remaining options become `voice_settings`, including numeric `stability`, `similarity_boost`, `style`, and `speed`, and boolean `use_speaker_boost`. |
| `music` | Streams `/v1/music` using the prompt and selected model. `music_length_ms` becomes an integer and `force_instrumental` becomes a boolean. |

These reference endpoints accept neither attachments nor a system prompt. The output format is derived from the declared audio MIME type and sent as the `output_format` query parameter. Binary output can be redirected to a sandbox file or piped into another command without a trailing newline.

| Required model `outputType` | Service format |
| --- | --- |
| `audio/mpeg` | `mp3_44100_128` |
| `audio/wav` | `wav_44100` (TTS only) |
| `audio/pcm` | `pcm_44100` |
| `audio/ogg` | `opus_48000_128` |
| `audio/basic` | `ulaw_8000` |

Other output types and a conflicting `output_format` option are rejected. The provider does not infer an audio output declaration from a missing `outputType`.

### Provider limits

Both factories accept `limits: Partial<LlmProviderLimits>`:

| Option | Default | Meaning |
| --- | --- | --- |
| `maxRequestBytes` | 64 MiB | Maximum encoded request body |
| `maxResponseBytes` | 64 MiB | Maximum bytes in each response body |
| `maxEventBytes` | 1 MiB | Maximum buffered chat event |
| `maxPolls` | 120 | Maximum video status polls |
| `pollIntervalMs` | 1,000 | Delay between video status polls |

Limits must be safe integers. Byte limits must be positive; polling count and interval may be zero. These provider bounds complement the shell's existing input, output, and execution limits. JSON image responses need bounded buffering before base64 decoding; audio and video content stream directly. Unit and packed-consumer checks use deterministic fake transports, not live service requests.
