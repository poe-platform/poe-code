import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "../../../src/fs/memory/index.js";
import { Shell } from "../../../src/shell/shell.js";
import { createLlmCommands, createLlmService, llmCommands, type LlmRequest, type LlmProvider } from "../../../src/commands/llm/index.js";

test("structured LLM service resolves aliases and preserves provider options without shell formatting", async () => {
  const requests: LlmRequest[] = [];
  const service = createLlmService({ defaultModel: "short", providers: [{ name: "fake", models: [{ id: "text", aliases: ["short"] }], async *complete(request) {
    requests.push(request);
    yield "answer";
  } }] });
  const signal = new AbortController().signal;
  const options = { temperature: "0.5" };
  const chunks = [];
  for await (const chunk of service.complete({ prompt: "hello", attachments: [], options, signal })) chunks.push(chunk);
  assert.deepEqual(chunks, ["answer"]);
  assert.equal(requests[0]!.model, "text");
  assert.equal(requests[0]!.signal, signal);
  assert.deepEqual(requests[0]!.options, options);
  assert.equal(service.resolve("fake/text").model.id, "text");
  assert.equal(service.models.length, 1);
  await assert.rejects(async () => {
    for await (const chunk of service.complete({ model: "missing", prompt: "", attachments: [], options: {}, signal })) assert.fail(`Unexpected response: ${String(chunk)}`);
  }, /Unknown model: missing/u);
  assert.equal(requests.length, 1);
});

test("structured LLM service checks cancellation and attachments before admitting provider work", async () => {
  let calls = 0;
  const service = createLlmService({ defaultModel: "text", providers: [{ name: "fake", models: [{ id: "text" }], async *complete() { calls++; yield "unexpected"; } }] });
  const request = { prompt: "", options: {}, attachments: [{ mimeType: "image/png", bytes: new Uint8Array([1]) }], signal: new AbortController().signal };
  await assert.rejects(async () => { for await (const chunk of service.complete(request)) assert.fail(`Unexpected response: ${String(chunk)}`); }, /does not accept image\/png/u);
  const controller = new AbortController();
  const reason = new Error("cancelled");
  controller.abort(reason);
  await assert.rejects(async () => { for await (const chunk of service.complete({ ...request, attachments: [], signal: controller.signal })) assert.fail(`Unexpected response: ${String(chunk)}`); }, error => error === reason);
  assert.equal(calls, 0);
});

for (const limit of [0, 5, 6]) {
  test(`llm enforces the existing combined input allowance ${limit}`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/one", new Uint8Array([1, 2]));
    await fs.writeFile("/two", new Uint8Array([3, 4]));
    let calls = 0;
    const shell = new Shell({ fs, limits: { maxInputBytes: limit } }).use(llmCommands({ providers: [{ name: "fake", models: [{ id: "a", attachmentTypes: ["application/octet-stream"] }], async *complete() { calls++; yield "ok"; } }], defaultModel: "a" }));
    try {
      const execution = shell.exec("llm --at /one application/octet-stream --at /two application/octet-stream", { stdin: limit === 0 ? "" : "ab" });
      if (limit < 6) await assert.rejects(execution, { name: "ShellLimitError", message: "Shell limit exceeded: maxInputBytes" });
      else assert.equal((await execution).exitCode, 0);
      assert.equal(calls, limit === 6 ? 1 : 0);
    } finally { await shell.dispose(); }
  });
}

test("llm resolves aliases, combines stdin and instruction, and passes options untouched", async () => {
  let request!: LlmRequest;
  const provider: LlmProvider = { name: "fake", models: [{ id: "text", aliases: ["t"] }], async *complete(value) { request = value; yield "hel"; yield "lo"; } };
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ providers: [provider], defaultModel: "t" }));
  try {
    const result = await shell.exec("llm -s system -o size 001 -o __proto__ safe summarize", { stdin: "content" });
    assert.equal(result.exitCode, 0);
    assert.equal(result.stdout, "hello\n");
    assert.equal(request.model, "text");
    assert.equal(request.prompt, "content\n\nsummarize");
    assert.equal(request.system, "system");
    assert.equal(request.options.size, "001");
    assert.equal(request.options.__proto__, "safe");
  } finally { await shell.dispose(); }
});

test("llm binary output preserves bytes and attachments use magic before extension", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/photo.mp3", new Uint8Array([255, 216, 255, 224]));
  let request!: LlmRequest;
  const provider: LlmProvider = { name: "fake", models: [{ id: "image", attachmentTypes: ["image/*"], outputType: "image/png" }], async *complete(value) { request = value; yield new Uint8Array([0, 255, 13]); } };
  const shell = new Shell({ fs }).use(llmCommands({ providers: [provider], defaultModel: "image" }));
  try {
    assert.equal((await shell.exec("llm -a /photo.mp3 draw > /out")).exitCode, 0);
    assert.deepEqual(await fs.readFile("/out"), new Uint8Array([0, 255, 13]));
    assert.equal(request.attachments[0]!.mimeType, "image/jpeg");
  } finally { await shell.dispose(); }
});

test("llm refuses unsupported attachments and unknown models before provider admission", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/audio.mp3", new Uint8Array([1]));
  let calls = 0;
  const provider: LlmProvider = { name: "fake", models: [{ id: "text" }], async *complete() { calls++; yield "bad"; } };
  const shell = new Shell({ fs }).use(llmCommands({ providers: [provider], defaultModel: "text" }));
  try {
    assert.match((await shell.exec("llm -a /audio.mp3")).stderr, /Model text does not accept audio\/mpeg/u);
    const unknown = await shell.exec("llm -m missing");
    assert.equal(unknown.exitCode, 1);
    assert.match(unknown.stderr, /Unknown model: missing/u);
    assert.equal(calls, 0);
  } finally { await shell.dispose(); }
});

test("llm rejects ambiguous ids and aliases at registration", () => {
  const complete = async function* () { yield ""; };
  for (const models of [[{ id: "a" }, { id: "a" }], [{ id: "a", aliases: ["b"] }, { id: "b" }]]) {
    assert.throws(() => createLlmCommands({ providers: [{ name: "fake", models, complete }] }), /Duplicate model/u);
  }
});

test("llm models lists all injected declarations without calling providers", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ providers: [{ name: "fake", models: [{ id: "a", aliases: ["alias"], attachmentTypes: ["audio/*"], outputType: "audio/mpeg" }], complete() { throw new Error("must not query"); } }] }));
  try {
    const result = await shell.exec("llm models");
    assert.equal(result.exitCode, 0);
    for (const text of ["fake/a", "alias", "audio/*", "audio/mpeg"]) assert.ok(result.stdout.includes(text));
  } finally { await shell.dispose(); }
});

for (const command of ["llm -- models", "llm -m text models"]) {
  test(`${command} sends the literal prompt to the provider`, async () => {
    let prompt: string | undefined;
    const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ defaultModel: "text", providers: [{ name: "fake", models: [{ id: "text" }], async *complete(request) { prompt = request.prompt; yield "answer"; } }] }));
    try {
      const result = await shell.exec(command);
      assert.equal(result.exitCode, 0);
      assert.equal(result.stdout, "answer\n");
      assert.equal(prompt, "models");
    } finally { await shell.dispose(); }
  });
}

test("llm mixed response rejects and closes the provider", async () => {
  let closed = false;
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ providers: [{ name: "fake", models: [{ id: "a" }], async *complete() { try { yield "text"; yield new Uint8Array([1]); } finally { closed = true; } } }], defaultModel: "a" }));
  try {
    const result = await shell.exec("llm");
    assert.equal(result.exitCode, 1);
    assert.match(result.stderr, /response/u);
    assert.equal(closed, true);
  } finally { await shell.dispose(); }
});

test("llm selects across providers, explicit MIME wins, and repeated options use their last value", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/file", new Uint8Array([255, 216, 255, 224]));
  let received!: LlmRequest;
  const shell = new Shell({ fs }).use(llmCommands({ providers: [
    { name: "one", models: [{ id: "one" }], complete() { throw new Error("wrong provider"); } },
    { name: "two", models: [{ id: "two", aliases: ["alias"], attachmentTypes: ["audio/wav"] }], async *complete(request) { received = request; yield "yes"; } },
  ], defaultModel: "one" }));
  try {
    assert.equal((await shell.exec("llm -m alias --at /file audio/wav -o speed 1 -o speed 2 -- --literal words")).stdout, "yes\n");
    assert.equal(received.prompt, "--literal words");
    assert.equal(received.options.speed, "2");
    assert.equal(received.attachments[0]!.mimeType, "audio/wav");
  } finally { await shell.dispose(); }
});

for (const [path, bytes, mime] of [
  ["/x.bin", [73, 68, 51], "audio/mpeg"],
  ["/x.bin", [...Buffer.from("RIFF0000WAVE")], "audio/wav"],
  ["/x.bin", [...Buffer.from("0000ftypisom")], "video/mp4"],
  ["/x.webm", [26, 69, 223, 163], "video/webm"],
  ["/x.mkv", [26, 69, 223, 163], "video/x-matroska"],
  ["/x.aac", [255, 241, 80, 128, 1, 127, 252], "audio/aac"],
  ["/x.aac", [255, 249, 80, 128, 1, 127, 252], "audio/aac"],
  ["/x.FLAC", [0], "audio/flac"],
  ["/x.__proto__", [0], "application/octet-stream"],
  ["/x.constructor", [0], "application/octet-stream"],
] as const) {
  test(`llm identifies ${mime} attachment`, async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile(path, new Uint8Array(bytes));
    const shell = new Shell({ fs }).use(llmCommands({ defaultModel: "a", providers: [{ name: "fake", models: [{ id: "a", attachmentTypes: [mime] }], async *complete(request) { assert.equal(request.attachments[0]!.mimeType, mime); yield "ok"; } }] }));
    try { assert.equal((await shell.exec(`llm -a ${path}`)).exitCode, 0); }
    finally { await shell.dispose(); }
  });
}

test("llm text chunking preserves a surrogate pair across the encoder boundary", async () => {
  const text = "a".repeat(16_383) + "😀z";
  const shell = new Shell({ fs: new MemoryFileSystem() }).use(llmCommands({ defaultModel: "a", providers: [{ name: "fake", models: [{ id: "a" }], async *complete() { yield text; } }] }));
  try { assert.equal((await shell.exec("llm")).stdout, `${text}\n`); }
  finally { await shell.dispose(); }
});

test("llm accepts an empty request under a zero input allowance", async () => {
  const shell = new Shell({ fs: new MemoryFileSystem(), limits: { maxInputBytes: 0 } }).use(llmCommands({ defaultModel: "a", providers: [{ name: "fake", models: [{ id: "a" }], async *complete(request) { assert.equal(request.prompt, ""); yield "ok"; } }] }));
  try { assert.equal((await shell.exec("llm")).stdout, "ok\n"); }
  finally { await shell.dispose(); }
});

test('shared LLM service rejects invalid scalar options before provider admission', async () => {
  let calls = 0;
  const service = createLlmService({defaultModel:'text',providers:[{name:'fake',models:[{id:'text'}],async *complete() { calls++; yield 'unexpected'; }}]});
  for (const value of [NaN,Infinity,{nested:true}]) {
    await assert.rejects(async () => {
      for await (const chunk of service.complete({prompt:'hello',attachments:[],options:{temperature:value} as LlmRequest['options'],signal:new AbortController().signal})) assert.fail(String(chunk));
    }, /finite|scalar/u);
  }
  assert.equal(calls, 0);
});

test('shared service validates conversation messages and delegates structured embeddings', async () => {
  let calls = 0;
  const provider: LlmProvider = {name:'shared',models:[{id:'model'}],async *complete() {calls++;yield 'answer';},
    async embed(request) { return {model:request.model,vectors:request.inputs.map(value => [value.length]),usage:{inputs:request.inputs.length}}; },
  };
  const service = createLlmService({providers:[provider],defaultModel:'model'});
  const signal = new AbortController().signal;
  assert.deepEqual(await service.embed({inputs:['hello','hi'],options:{dimensions:1},signal}),{model:'model',vectors:[[5],[2]],usage:{inputs:2}});
  assert.throws(() => service.complete({prompt:'',attachments:[],options:{},messages:[{role:'unsupported',content:'x'}],signal}),/message/u);
  assert.equal(calls,0);
});

test('shared service renders registered templates before provider admission and enforces input limits', async () => {
  const requests: LlmRequest[] = [];
  const service = createLlmService({defaultModel:'model',templates:{summary:'Summarize {topic} in {count} points'},providers:[{name:'fixture',models:[{id:'model'}],async *complete(request) {requests.push(request);yield 'answer';}}]});
  const request = {prompt:'extra',template:'summary',parameters:{topic:'gravity',count:2},options:{},attachments:[],signal:new AbortController().signal};
  for await (const chunk of service.complete(request)) assert.equal(chunk,'answer');
  assert.equal(requests[0]!.prompt,'Summarize gravity in 2 points\n\nextra');
  assert.throws(() => service.complete({...request,parameters:{topic:'gravity'}}),/parameter/u);
  assert.throws(() => service.complete({...request,template:'missing'}),/template/u);
  assert.throws(() => service.complete({...request,maxInputBytes:1}),/input limit/u);
  assert.equal(requests.length,1);
});
