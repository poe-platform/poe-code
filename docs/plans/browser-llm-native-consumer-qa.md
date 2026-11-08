# Browser LLM native consumer QA

1. Copy `scripts/bundle-safe-bash.test.ts` to a temporary sibling Vitest fixture and replace only its reference-transport test with the original control below. This retains the current `bundlePublicConsumer`, browser artifacts, VM and filesystem setup.
2. Run that exact temporary fixture with the maintained root test selector and the original five-second deadline. Verify both providers use injected transports, preserve temperature, binary output and response disposal without Node globals.
3. The fast unit test executes the same behavior against the suite's already bundled public browser entry. The separate root/subpath factory identity checks retain public API identity coverage.
4. Store temporary evidence under `out` and remove the temporary fixture after verification.

```ts
it("runs both reference llm transports without Node globals in a browser consumer", async () => {
  const compiled = await bundlePublicConsumer(`
    import { Shell, agentCommands, createMemoryFileSystem, toByteSource } from "@poe-platform/safe-bash";
    import { llmCommands, createOpenAiProvider, createElevenLabsProvider } from "@poe-platform/safe-bash/commands/llm";
    export async function run() {
      const requests = [];
      let disposed = 0;
      let temperature;
      const transport = async request => {
        requests.push(request.url);
        if (request.url.includes("chat/completions")) {
          const chunks = [];
          for await (const chunk of request.body) chunks.push(Uint8Array.from(chunk));
          temperature = JSON.parse(await new Blob(chunks).text()).temperature;
        }
        const content = request.url.includes("chat/completions")
          ? 'data: {"choices":[{"delta":{"content":"fox"}}]}\\n\\ndata: [DONE]\\n\\n'
          : request.url.includes("images") ? '{"data":[{"b64_json":"iVBORw=="}]}' : new Uint8Array([255,0,128]);
        return { status:200, statusText:"OK", headers:[], body:toByteSource(content), async dispose() { disposed++; } };
      };
      const providers = [createOpenAiProvider({ transport, apiKey:"fixture", models:[
        { id:"caption", endpoint:"chat", attachmentTypes:["image/*"] },
        { id:"draw", endpoint:"images", attachmentTypes:["image/*"], outputType:"image/png" }
      ] }), createElevenLabsProvider({ transport, apiKey:"fixture", models:[
        { id:"voice", endpoint:"tts", defaultVoiceId:"speaker", outputType:"audio/mpeg" }
      ] })];
      const fs = createMemoryFileSystem();
      await fs.writeFile("/fox.png", new Uint8Array([137,80,78,71,13,10,26,10]));
      const shell = new Shell({ fs }).use(agentCommands()).use(llmCommands({ providers, defaultModel:"caption" }));
      try {
        const audio = await shell.exec("llm --at /fox.png Image/PNG -o temperature 0.7 caption | llm -m voice | base64");
        const image = await shell.exec("llm -m draw -a /fox.png edit | base64");
        return { audio, image, requests, disposed, temperature };
      } finally { await shell.dispose(); }
    }
  `);
  const sandbox = createContext({
    TextEncoder, TextDecoder, Uint8Array, ArrayBuffer, TransformStream, ReadableStream, WritableStream,
    AbortController, AbortSignal, setTimeout, clearTimeout, queueMicrotask, crypto: globalThis.crypto, performance,
    URL, FormData, Blob, Response, btoa, atob,
    require(name: string) {
      if (name !== "@poe-platform/safe-fs/core") throw new Error(name);
      return filesystem;
    },
  });
  const consumer = runInContext(`(function(){ const module = { exports: {} }; ${compiled}; return module.exports; })()`, sandbox);
  const result = await consumer.run();
  expect(result.audio).toMatchObject({ exitCode: 0, stdout: "/wCA\n", stderr: "" });
  expect(result.image).toMatchObject({ exitCode: 0, stdout: "iVBORw==\n", stderr: "" });
  expect(result.requests).toEqual([
    "https://api.openai.com/v1/chat/completions",
    "https://api.elevenlabs.io/v1/text-to-speech/speaker?output_format=mp3_44100_128",
    "https://api.openai.com/v1/images/edits",
  ]);
  expect(result.disposed).toBe(3);
  expect(result.temperature).toBe(0.7);
});
```
