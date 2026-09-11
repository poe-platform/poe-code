import assert from "node:assert/strict";
import test from "node:test";
import { createLlmCommands } from "../../../src/commands/llm/command.js";
import { createOpenAiProvider, type OpenAiModel } from "../../../src/commands/llm/openai.js";
import { createElevenLabsProvider, type ElevenLabsModel } from "../../../src/commands/llm/elevenlabs.js";
import { acceptsMimeType } from "../../../src/commands/llm/mime.js";
import type { LlmProvider } from "../../../src/commands/llm/types.js";
import type { HttpRequest, HttpResponse, HttpTransport } from "../../../src/commands/network/types.js";
import { toByteSource, type InvocationCleanup } from "../../../src/contracts/index.js";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";

const image = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10, 0, 255);
const video = Uint8Array.of(0, 0, 0, 20, 102, 116, 121, 112, 0, 255);
const audio = Uint8Array.of(255, 251, 0, 128, 10, 0, 255);

async function execute(provider: LlmProvider, args: readonly string[]) {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/fixture.png", image);
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const cleanups: InvocationCleanup[] = [];
  const command = createLlmCommands({ providers: [provider], defaultModel: "configured" })[0]!;
  try {
    const result = await command.execute({
      command: "llm", args, fs, cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: { async write(chunk) { stdout.push(Uint8Array.from(chunk)); } },
      stderr: { async write(chunk) { stderr.push(Uint8Array.from(chunk)); } },
      registerCleanup(cleanup) { cleanups.push(cleanup); },
    });
    return { exitCode: result.exitCode, stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr).toString() };
  } finally {
    for (const cleanup of cleanups) await cleanup();
  }
}

async function requestBody(request: HttpRequest): Promise<Response> {
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  if (request.body) for await (const chunk of request.body) chunks.push(Uint8Array.from(chunk));
  return new Response(new Blob(chunks), { headers: request.headers.map(([name, value]): [string, string] => [name, value]) });
}

function response(body: string | Uint8Array): HttpResponse {
  return { status: 200, statusText: "OK", headers: [], body: toByteSource(body), async dispose() {} };
}

for (const endpoint of ["chat", "images", "videos"] as const) {
  for (const mimeType of ["image/png", "image/png; profile=fixture", "Image/PNG", "Image/PNG; profile=fixture"]) {
    test(`provider acceptance: OpenAI ${endpoint} accepts --at ${mimeType}`, async () => {
      assert.equal(acceptsMimeType(["image/*"], mimeType), true);
      const requests: HttpRequest[] = [];
      let upload: Response | undefined;
      const transport: HttpTransport = async request => {
        requests.push(request);
        if (request.method === "POST") upload = await requestBody(request);
        if (endpoint === "chat") return response('data: {"choices":[{"delta":{"content":"accepted"}}]}\n\ndata: [DONE]\n\n');
        if (endpoint === "images") return response('{"data":[{"b64_json":"iVBORw0KGgoA/w=="}]}');
        return request.method === "POST" ? response('{"id":"fixture-job","status":"completed"}') : response(video);
      };
      const model: OpenAiModel = {
        id: "configured", endpoint, attachmentTypes: ["image/*"],
        ...(endpoint === "chat" ? {} : { outputType: endpoint === "images" ? "image/png" : "video/mp4" }),
      };
      const provider = createOpenAiProvider({ transport, apiKey: "fixture-key", models: [model] });
      const result = await execute(provider, ["--at", "/fixture.png", mimeType, "inspect", "-o", "future_option", "001"]);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdout, Buffer.from(endpoint === "chat" ? "accepted\n" : endpoint === "images" ? image : video));
      assert.ok(upload);
      if (endpoint === "chat") {
        assert.equal(new URL(requests[0]!.url).pathname, "/v1/chat/completions");
        const body = await upload.json() as { model: string; stream: boolean; future_option: string; messages: { content: { image_url?: { url: string } }[] }[] };
        assert.equal(body.model, "configured");
        assert.equal(body.stream, true);
        assert.equal(body.future_option, "001");
        const dataUrl = body.messages[0]!.content[1]!.image_url!.url;
        assert.equal(dataUrl.slice(5).split(";", 1)[0]!.toLowerCase(), "image/png");
        assert.ok(dataUrl.endsWith(";base64,iVBORw0KGgoA/w=="));
      } else {
        assert.equal(new URL(requests[0]!.url).pathname, endpoint === "images" ? "/v1/images/edits" : "/v1/videos");
        const form = await upload.formData();
        assert.equal(form.get("model"), "configured");
        assert.equal(form.get("prompt"), "inspect");
        assert.equal(form.get("future_option"), "001");
        const attachment = form.get(endpoint === "images" ? "image[]" : "input_reference");
        assert.ok(attachment instanceof Blob);
        assert.equal(attachment.type.split(";", 1)[0]!.toLowerCase(), "image/png");
        assert.deepEqual(new Uint8Array(await attachment.arrayBuffer()), image);
      }
      assert.equal(requests.length, endpoint === "videos" ? 2 : 1);
    });
  }
}

for (const endpoint of ["tts", "music"] as const) {
  test(`provider acceptance: ElevenLabs ${endpoint} rejects omitted outputType`, () => {
    let requests = 0;
    const transport: HttpTransport = async () => { requests++; return response(audio); };
    assert.throws(() => createElevenLabsProvider({ transport, apiKey: "fixture-key", models: [{ id: "configured", endpoint }] }), /outputType/);
    assert.equal(requests, 0);
  });
  for (const outputType of ["audio/mpeg", "Audio/MPEG", "audio/mpeg; profile=fixture"]) {
    test(`provider acceptance: ElevenLabs ${endpoint} derives MP3 for ${outputType}`, async () => {
      const requests: HttpRequest[] = [];
      let upload: Response | undefined;
      const transport: HttpTransport = async request => {
        requests.push(request);
        upload = await requestBody(request);
        return response(audio);
      };
      const model: ElevenLabsModel = {
        id: "configured", endpoint, defaultVoiceId: "configured-voice",
        outputType,
      };
      const provider = createElevenLabsProvider({ transport, apiKey: "fixture-key", models: [model] });
      const args = endpoint === "tts"
        ? ["speak", "-o", "voice_id", "selected-voice", "-o", "speed", "1.20", "-o", "future_option", "001"]
        : ["compose", "-o", "music_length_ms", "30000", "-o", "force_instrumental", "false", "-o", "future_option", "001"];
      const result = await execute(provider, args);
      assert.equal(result.exitCode, 0, result.stderr);
      assert.equal(result.stderr, "");
      assert.deepEqual(result.stdout, Buffer.from(audio));
      assert.equal(requests.length, 1);
      const url = new URL(requests[0]!.url);
      assert.equal(url.pathname, endpoint === "tts" ? "/v1/text-to-speech/selected-voice" : "/v1/music");
      assert.equal(url.searchParams.get("output_format"), "mp3_44100_128");
      assert.equal(provider.models[0]!.outputType, outputType);
      assert.ok(upload);
      assert.deepEqual(await upload.json(), endpoint === "tts" ? {
        text: "speak", model_id: "configured", voice_settings: { speed: 1.2, future_option: "001" },
      } : {
        prompt: "compose", model_id: "configured", music_length_ms: 30000, force_instrumental: false, future_option: "001",
      });
    });
  }
}

for (const [endpoint, key, value, expected] of [
  ["chat", "temperature", "0.70", 0.7],
  ["chat", "top_p", "0.80", 0.8],
  ["chat", "frequency_penalty", "-0.5", -0.5],
  ["chat", "presence_penalty", "0.5", 0.5],
  ["chat", "max_tokens", "32", 32],
  ["chat", "max_completion_tokens", "64", 64],
  ["chat", "n", "1", 1],
  ["chat", "seed", "-123", -123],
  ["chat", "top_logprobs", "0", 0],
  ["images", "n", "1", 1],
  ["images", "output_compression", "80", 80],
  ["images", "partial_images", "0", 0],
] as const) {
  test(`provider acceptance: OpenAI ${endpoint} serializes ${key} as a JSON number`, async () => {
    let upload: Response | undefined;
    const transport: HttpTransport = async request => {
      upload = await requestBody(request);
      return response(endpoint === "chat" ? 'data: {"choices":[{"delta":{"content":"accepted"}}]}\n\ndata: [DONE]\n\n' : '{"data":[{"b64_json":"iVBORw0KGgoA/w=="}]}');
    };
    const provider = createOpenAiProvider({ transport, apiKey: "fixture-key", models: [{
      id: "configured", endpoint, ...(endpoint === "images" ? { outputType: "image/png" } : {}),
    }] });
    const result = await execute(provider, ["describe", "-o", key, value, "-o", "future_option", "001"]);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.ok(upload);
    const body = await upload.json() as Record<string, unknown>;
    assert.equal(body[key], expected, `${endpoint}.${key} must use the OpenAI JSON number schema, not the CLI string representation`);
    assert.equal(body.future_option, "001");
  });
}

test("provider acceptance: issue-named image options remain JSON strings", async () => {
  let upload: Response | undefined;
  const transport: HttpTransport = async request => {
    upload = await requestBody(request);
    return response('{"data":[{"b64_json":"iVBORw0KGgoA/w=="}]}');
  };
  const provider = createOpenAiProvider({ transport, apiKey: "fixture-key", models: [{ id: "configured", endpoint: "images", outputType: "image/png" }] });
  const result = await execute(provider, ["paint", "-o", "size", "1024x1024", "-o", "quality", "high", "-o", "background", "transparent"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.ok(upload);
  assert.deepEqual(await upload.json(), { model: "configured", prompt: "paint", size: "1024x1024", quality: "high", background: "transparent", output_format: "png" });
});

test("provider acceptance: issue-named video seconds and size remain multipart strings", async () => {
  let upload: Response | undefined;
  const transport: HttpTransport = async request => {
    if (request.method === "POST") {
      upload = await requestBody(request);
      return response('{"id":"fixture-job","status":"completed"}');
    }
    return response(video);
  };
  const provider = createOpenAiProvider({ transport, apiKey: "fixture-key", models: [{ id: "configured", endpoint: "videos", outputType: "video/mp4" }] });
  const result = await execute(provider, ["animate", "-o", "seconds", "8", "-o", "size", "1280x720"]);
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, Buffer.from(video));
  assert.ok(upload);
  const form = await upload.formData();
  assert.equal(form.get("seconds"), "8");
  assert.equal(form.get("size"), "1280x720");
});

for (const [endpoint, key, value] of [
  ["chat", "temperature", ""], ["chat", "temperature", "   "],
  ["chat", "temperature", "NaN"], ["chat", "temperature", "Infinity"],
  ["chat", "temperature", "1e999"], ["chat", "temperature", "false"],
  ["chat", "max_tokens", "3.5"], ["chat", "max_completion_tokens", "3.5"],
  ["chat", "n", "1.5"], ["chat", "seed", "9007199254740993"],
  ["chat", "top_logprobs", "1.5"], ["images", "n", "1.5"],
  ["images", "output_compression", "80.5"], ["images", "partial_images", "0.5"],
] as const) {
  test(`provider acceptance: OpenAI rejects invalid ${endpoint}.${key} ${JSON.stringify(value)} before transport`, async () => {
    let calls = 0;
    const transport: HttpTransport = async () => {
      calls++;
      return response(endpoint === "chat" ? "data: [DONE]\n\n" : '{"data":[{"b64_json":"iVBORw0KGgoA/w=="}]}');
    };
    const provider = createOpenAiProvider({ transport, apiKey: "fixture-key", models: [{
      id: "configured", endpoint, ...(endpoint === "images" ? { outputType: "image/png" } : {}),
    }] });
    const result = await execute(provider, ["describe", "-o", key, value]);
    assert.equal(result.exitCode, 1);
    assert.ok(result.stderr.includes(`Invalid OpenAI option ${key}`), result.stderr);
    assert.equal(calls, 0);
  });
}

test("provider acceptance: OpenAI leaves unknown option strings and image-edit multipart numbers untouched", async () => {
  let upload: Response | undefined;
  const transport: HttpTransport = async request => {
    upload = await requestBody(request);
    return response('{"data":[{"b64_json":"iVBORw0KGgoA/w=="}]}');
  };
  const provider = createOpenAiProvider({ transport, apiKey: "fixture-key", models: [{ id: "configured", endpoint: "images", outputType: "image/png", attachmentTypes: ["image/*"] }] });
  const unknown = ["-o", "future_number", "001", "-o", "future_boolean", "true", "-o", "future_null", "null", "-o", "future_object", '{"value":1}'];
  const generated = await execute(provider, ["paint", ...unknown]);
  assert.equal(generated.exitCode, 0, generated.stderr);
  assert.ok(upload);
  assert.deepEqual(await upload.json(), { model: "configured", prompt: "paint", output_format: "png", future_number: "001", future_boolean: "true", future_null: "null", future_object: '{"value":1}' });
  const edited = await execute(provider, ["paint", "--at", "/fixture.png", "image/png", "-o", "n", "01", "-o", "output_compression", "080", ...unknown]);
  assert.equal(edited.exitCode, 0, edited.stderr);
  const form = await upload.formData();
  assert.equal(form.get("n"), "01");
  assert.equal(form.get("output_compression"), "080");
  assert.equal(form.get("future_number"), "001");
  assert.equal(form.get("future_boolean"), "true");
  assert.equal(form.get("future_null"), "null");
  assert.equal(form.get("future_object"), '{"value":1}');
});

test("provider acceptance: ElevenLabs MIME normalization still rejects control characters", () => {
  const transport: HttpTransport = async () => response(audio);
  for (const outputType of ["audio/mpeg\r\n", "audio/mpeg; profile=\0", "audio/mpeg; profile=\u007f"]) {
    assert.throws(() => createElevenLabsProvider({ transport, apiKey: "fixture-key", models: [{ id: "configured", endpoint: "tts", defaultVoiceId: "voice", outputType }] }));
  }
});
