import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { toByteSource } from "safe-bash-contracts";
import { createLlmCommand } from "./command.js";
import { createLlmTemplateStore, type LlmTemplateLoader } from "./templates.js";

test("remote template loading accepts an unlimited byte quota", async () => {
  const store = createLlmTemplateStore({
    command: "llm", args: [], fs: new MemoryFileSystem(), cwd: "/", env: {},
    signal: new AbortController().signal, stdin: toByteSource(""),
    stdout: { async write() {} }, stderr: { async write() {} },
    fetch: async () => new Response("prompt: remote\n"),
  }, { maxRemoteBytes: Infinity });
  assert.equal((await store.load("https://fixture.test/template")).prompt, "remote");
});

test("template loaders support URL fetch, plugin prefixes, byte limits, and independent abort cleanup", async () => {
  const cases = [
    {
      name: "https://fixture.test/template",
      status: 200,
      statusText: "OK",
      body: "prompt: remote\n",
      result: { value: { name: "https://fixture.test/template", prompt: "remote" }, functionsTrusted: false },
    },
    {
      name: "http://fixture.test/template?x=1",
      status: 200,
      statusText: "OK",
      body: "prompt: \"remote $input\"\nfunctions: \"def remote(): return 1\"\n",
      result: { value: { name: "http://fixture.test/template?x=1", prompt: "remote $input", functions: "def remote(): return 1" }, functionsTrusted: false },
    },
    {
      name: "https://fixture.test/missing",
      status: 404,
      statusText: "Not Found",
      body: "missing",
      result: { error: "Could not load template https://fixture.test/missing: Client error '404 Not Found' for url 'https://fixture.test/missing'\nFor more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/404" },
    },
    {
      name: "https://fixture.test/error",
      status: 500,
      statusText: "Internal Server Error",
      body: "failure",
      result: { error: "Could not load template https://fixture.test/error: Server error '500 Internal Server Error' for url 'https://fixture.test/error'\nFor more information check: https://developer.mozilla.org/en-US/docs/Web/HTTP/Status/500" },
    },
    {
      name: "fixture:remaining:value",
      result: { value: { name: "plugin-name", prompt: "plugin remaining:value", functions: "def plugin(): return 1" }, functionsTrusted: false },
    },
    {
      name: "fixture:",
      result: { value: { name: "plugin-name", prompt: "plugin ", functions: "def plugin(): return 1" }, functionsTrusted: false },
    },
    {
      name: "failing:value",
      result: { error: "Could not load template failing:value: loader failed" },
    },
    {
      name: "unknown:value",
      result: { error: "Unknown template prefix: unknown" },
    },
  ] as const;

  const loaders = new Map<string, LlmTemplateLoader>([
    ["fixture", Object.assign((remainder: string) => ({ name: "plugin-name", prompt: `plugin ${remainder}`, functions: "def plugin(): return 1" }), { description: "Load fixture text." })],
    ["failing", () => { throw new Error("loader failed"); }],
  ]);

  for (const item of cases) {
    const fs = new MemoryFileSystem();
    const store = createLlmTemplateStore(
      {
        command: "llm",
        args: [],
        fs,
        cwd: "/",
        env: { LLM_USER_PATH: "/settings" },
        signal: new AbortController().signal,
        stdin: toByteSource(""),
        stdout: { async write() {} },
        stderr: { async write() {} },
        fetch: async () => new Response("body" in item ? item.body : "", { status: "status" in item ? item.status : 200, statusText: "statusText" in item ? item.statusText : "OK" }),
      },
      { maxRemoteBytes: 1024, loaders },
    );
    if ("error" in item.result) {
      await assert.rejects(() => store.load(item.name), { message: item.result.error });
    } else {
      const loaded = await store.load(item.name) as unknown as Record<string, unknown>;
      assert.deepEqual(loaded, item.result.value as unknown);
      assert.equal((loaded as Record<string, unknown>).functionsTrusted, item.result.functionsTrusted);
    }
  }

  const controller = new AbortController();
  const reason = new Error("worker cancellation");
  let enter!: () => void;
  let release!: (response: Response) => void;
  let cancelled = 0;
  const ready = new Promise<void>(resolve => { enter = resolve; });
  const pending = new Promise<Response>(resolve => { release = resolve; });
  const store = createLlmTemplateStore(
    {
      command: "llm",
      args: [],
      fs: new MemoryFileSystem(),
      cwd: "/",
      env: { LLM_USER_PATH: "/settings" },
      signal: controller.signal,
      stdin: toByteSource(""),
      stdout: { async write() {} },
      stderr: { async write() {} },
      fetch: () => { enter(); return pending; },
    },
    { maxRemoteBytes: 1024 },
  );
  let settled = false;
  let failure: unknown;
  const operation = store.load("https://fixture.test/template").then(() => { settled = true; }, error => { settled = true; failure = error; });
  await ready;
  controller.abort(reason);
  for (let i = 0; i < 30; i++) await Promise.resolve();
  assert.equal(settled, true);
  assert.equal(failure, reason);
  release(new Response(new ReadableStream({ cancel() { cancelled++; } })));
  for (let i = 0; i < 30; i++) await Promise.resolve();
  await operation;
  assert.equal(cancelled, 1);
});

test("templates CLI subcommands match reference loader listing, YAML formatting, COLUMNS truncation, and editor workflow", async () => {
  const loaderA = Object.assign((remainder: string) => ({ name: "a", prompt: `a:${remainder}` }), { description: "  First loader\n    indented line" });
  const loaderZ = Object.assign((remainder: string) => ({ name: "z", prompt: `z:${remainder}` }), { description: "Last loader" });
  const fs = new MemoryFileSystem();
  await fs.mkdir("/settings/templates", { recursive: true });
  await fs.writeFile("/settings/templates/extras.yaml", new TextEncoder().encode("prompt: hi\nextract: true\nextract_last: false\nschema_object: {type: object}\nfragments: [one]\nsystem_fragments: [two]\ntools: [three]\nfunctions: \"def x(): pass\"\n"));
  const command = createLlmCommand({
    providers: [{ name: "fixture", models: [{ id: "fixture-chat" }], async *complete(req) { yield req.prompt; } }],
    templateLoaders: new Map<string, LlmTemplateLoader>([["z-last", loaderZ], ["a-first", loaderA]]),
  });
  const run = async (args: string[], env: Record<string, string> = {}) => {
    let stdout = "", stderr = "";
    const res = await command.execute({
      command: "llm",
      args,
      fs,
      cwd: "/",
      env: { LLM_USER_PATH: "/settings", ...env },
      signal: new AbortController().signal,
      stdin: toByteSource(""),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } },
      async invoke(cmd, invokeArgs) {
        assert.equal(cmd, "sh");
        await fs.writeFile(invokeArgs[3]!, new TextEncoder().encode("prompt: edited template\n"));
        return { exitCode: 0 };
      },
    });
    return { ...res, stdout, stderr };
  };
  const loadersRes = await run(["templates", "loaders"]);
  assert.equal(loadersRes.exitCode, 0);
  assert.equal(loadersRes.stdout, "z-last:\n  Last loader\na-first:\n  First loader\n    indented line\n");

  const showRes = await run(["templates", "show", "extras"]);
  assert.equal(showRes.exitCode, 0);
  assert.equal(showRes.stdout, "extract: true\nextract_last: false\nfragments:\n- one\nfunctions: 'def x(): pass'\nname: extras\nprompt: hi\nschema_object:\n    type: object\nsystem_fragments:\n- two\ntools:\n- three\n\n");

  const editRes = await run(["templates", "edit", "fresh"], { EDITOR: "my-editor" });
  assert.equal(editRes.exitCode, 0);
  assert.equal(new TextDecoder().decode(await fs.readFile("/settings/templates/fresh.yaml")), "prompt: edited template\n");

  const badArgRes = await run(["templates", "list", "--", "--help"]);
  assert.equal(badArgRes.exitCode, 2);
  assert.equal(badArgRes.stderr, "Usage: llm templates list [OPTIONS]\nTry 'llm templates list -h' for help.\n\nError: Got unexpected extra argument (--help)\n");

  const promptViaLoader = await run(["-m", "fixture-chat", "-t", "a-first:hello"]);
  assert.equal(promptViaLoader.exitCode, 0);
  assert.equal(promptViaLoader.stdout, "a:hello\n");
});

test("remote template command defaults are unlimited and finite caps remain enforced", async () => {
  const prompt = "x".repeat(1_048_577);
  for (const maxRemoteTemplateBytes of [undefined, Infinity, 1_048_576]) {
    let stdout = "", stderr = "";
    const command = createLlmCommand({
      ...(maxRemoteTemplateBytes === undefined ? {} : { maxRemoteTemplateBytes }),
      providers: [{ name: "fixture", models: [{ id: "fixture-chat" }], async *complete(request) { yield request.prompt; } }],
      defaultModel: "fixture-chat",
    });
    const result = await command.execute({
      command: "llm", args: ["-t", "https://fixture.test/template", "--no-log"],
      fs: new MemoryFileSystem(), cwd: "/", env: {}, signal: new AbortController().signal,
      stdin: toByteSource(""), ...{ fetch: async () => new Response(`prompt: ${prompt}\n`) },
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    });
    if (maxRemoteTemplateBytes === 1_048_576) {
      assert.equal(result.exitCode, 1);
      assert.match(stderr, /Template URL exceeds byte limit/);
      assert.equal(stdout, "");
    } else {
      assert.equal(result.exitCode, 0, stderr);
      assert.equal(stdout.trimEnd(), prompt);
    }
  }
});

for(const limit of [Infinity,1])test(`template loader output is forwarded within command limit ${limit}`,async()=>{
 const fs=new MemoryFileSystem();let output='',error='';
 const loader:LlmTemplateLoader=async(value,signal,context)=>{
  assert.equal(value,'value');assert.ok(context);assert.equal(context.fs,fs);assert.equal(context.signal,signal);assert.equal(context.cwd,'/');assert.ok(context.maxBytes>0);
  await context.stdout?.write(new TextEncoder().encode('plugin output\n'));
  await context.stderr?.write(new TextEncoder().encode('plugin diagnostic\n'));
  return {name:'native',prompt:'$input',system:'native system'};
 };
 const command=createLlmCommand({templateLoaders:new Map([['native',loader]]),limits:{maxOutputBytes:limit},defaultModel:'fixture',providers:[{name:'fixture',models:[{id:'fixture'}],async *complete(request){assert.equal(request.system,'native system');yield request.prompt;}}]});
 const result=await command.execute({command:'llm',args:['-t','native:value','question'],fs,cwd:'/',env:{},signal:new AbortController().signal,stdin:toByteSource(''),stdout:{async write(bytes){output+=new TextDecoder().decode(bytes);}},stderr:{async write(bytes){error+=new TextDecoder().decode(bytes);}}});
 if(limit===Infinity){assert.equal(result.exitCode,0,error);assert.equal(output,'plugin output\nquestion\n');assert.equal(error,'plugin diagnostic\n');}
 else{assert.equal(result.exitCode,1);assert.equal(output,'');assert.match(error,/output byte limit exceeded/);}
});
