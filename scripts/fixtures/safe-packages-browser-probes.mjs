import {
  Shell, agentCommands, createMemoryFileSystem, toByteSource, createNetworkCommands,
  nodeCommands, safeJsCommands, createNodeCommands, createNodeCommand,
} from "@poe-platform/safe-bash";
import {
  nodeCommands as leafPlugin, createNodeCommands as leafCommands, createNodeCommand as leafCommand,
} from "@poe-platform/safe-bash/commands/node";
import { llmCommands, createOpenAiProvider, createElevenLabsProvider } from "@poe-platform/safe-bash/commands/llm";

export async function runNode(factory) {
  const configure = { nodeCommands, safeJsCommands }[factory];
  const sources = [];
  const imports = [];
  const runtime = {
    createBudget: options => options,
    makeFsModule: () => ({ readFile: async () => "virtual" }),
    declareHostOperation: operation => operation,
    async run(source, options) {
      sources.push(source);
      imports.push({ names: options.importSpecifiers, aliases: ["fs/promises", "node:fs/promises"].every(name => options.modules[name].readFile === options.modules.fs.promises.readFile) });
      options.sink.log(3);
      return { ok: true };
    },
  };
  const shell = new Shell({ fs: createMemoryFileSystem() }).use(configure({ runtime }));
  try {
    const result = await shell.exec("node -p '1 + 2'");
    const missing = await shell.exec("safejs --help");
    return {
      result, missing, sources, imports, names: shell.commands.list().map(command => command.name),
      shared: nodeCommands === leafPlugin && createNodeCommands === leafCommands && createNodeCommand === leafCommand,
    };
  } finally { await shell.dispose(); }
}

export async function runInjectedLlm() {
  const requests = [];
  const providers = [{
    name: "captions", models: [{ id: "describe", attachmentTypes: ["image/*"] }],
    async *complete(request) { requests.push(request); yield "a fox"; }
  }, {
    name: "audio", models: [{ id: "voice", aliases: ["tts"], outputType: "audio/mpeg" }],
    async *complete(request) { requests.push(request); yield new Uint8Array([255, 0, 128]); }
  }];
  const fs = createMemoryFileSystem();
  await fs.writeFile("/fox.png", new Uint8Array([137,80,78,71,13,10,26,10]));
  const shell = new Shell({ fs }).use(agentCommands()).use(llmCommands({ providers, defaultModel: "describe" }));
  try {
    const result = await shell.exec("llm -a /fox.png 'caption' | llm -m tts > /voice.mp3; base64 /voice.mp3");
    return { result, requests };
  } finally { await shell.dispose(); }
}

export async function runReferenceLlm() {
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
      ? 'data: {"choices":[{"delta":{"content":"fox"}}]}\n\ndata: [DONE]\n\n'
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

export async function probeNetwork() {
  let refused = false;
  try { createNetworkCommands({ authorize: () => true, limits: { maxUrls: 1, maxBufferBytes: 1024 } }); } catch { refused = true; }
  const fs = createMemoryFileSystem();
  const requests = [];
  const commands = createNetworkCommands({ authorize: () => true, limits: { maxUrls: 1, maxBufferBytes: 1024 }, transport: async request => {
    requests.push(request);
    return { status: 200, statusText: "OK", headers: [], body: toByteSource("ok"), async dispose() {} };
  } });
  const output = [];
  const context = { command: "curl", args: ["-H", "X-Test: allowed", "https://example.test/file"], fs, cwd: "/", env: {},
    stdin: toByteSource(""), signal: new AbortController().signal,
    stdout: { async write(bytes) { output.push(...bytes); } }, stderr: { async write() {} } };
  const valid = await commands[0].execute(context);
  const invalid = await commands[0].execute({ ...context, args: ["-H", "Bad Name: nope", "https://example.test/file"] });
  const value = await commands[0].execute({ ...context, args: ["-H", "X-Test: bad\u0001", "https://example.test/file"] });
  const multipart = await commands[0].execute({ ...context, args: ["-F", "field=value", "https://example.test/file"] });
  return { refused, valid: valid.exitCode, invalid: invalid.exitCode, value: value.exitCode, multipart: multipart.exitCode, requests: requests.length, output };
}
