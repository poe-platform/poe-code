import assert from "node:assert/strict";
import test from "node:test";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createLlmCommand } from "./command.js";
import { createLlmToolRegistry, selectLlmTools } from "./tool-registry.js";
import { executeLlmToolCalls } from "./tool-execution.js";
import fixtures from "./fixtures/tools-list-0.27.1.json" with { type: "json" };

const definitions = [
  {
    name: "zeta",
    description: "  Find Zürich.\n\nKeep spacing.  ",
    inputSchema: { type: "object", properties: { query: { type: "string" } } },
    plugin: "fixture"
  },
  { name: "alpha", inputSchema: {} },
  { name: "zeta", description: "Second registration", inputSchema: { type: "object" } }
];

for (const fixture of fixtures)
  test(`pinned tool discovery: ${fixture.argv.join(" ")}`, async () => {
    const command = createLlmCommand({ tools: createLlmToolRegistry(definitions) });
    let stdout = "",
      stderr = "";
    const result = await command.execute({
      command: "llm",
      args: fixture.argv,
      fs: new MemoryFileSystem(),
      cwd: "/",
      env: {},
      signal: new AbortController().signal,
      stdin: {
        [Symbol.asyncIterator]() {
          throw new Error("discovery must not read stdin");
        }
      },
      stdout: {
        async write(bytes) {
          stdout += new TextDecoder().decode(bytes);
        }
      },
      stderr: {
        async write(bytes) {
          stderr += new TextDecoder().decode(bytes);
        }
      }
    });
    assert.equal(result.exitCode, fixture.exitCode, stderr);
    assert.equal(stdout, fixture.stdout);
    assert.equal(stderr, fixture.stderr);
  });

test("registry collisions preserve names and selection order without running implementations", () => {
  const implementation = () => {
    throw new Error("discovery must not execute tools");
  };
  const registry = createLlmToolRegistry([
    ...definitions,
    { name: "zeta_1", inputSchema: {}, implementation }
  ]);
  assert.deepEqual([...registry.keys()], ["zeta", "alpha", "zeta_1", "zeta_1_1"]);
  assert.deepEqual(selectLlmTools(registry, ["zeta_1", "zeta"]), [definitions[2], definitions[0]]);
  assert.throws(
    () => selectLlmTools(registry, ["missing", "other"]),
    /Tool\(s\) missing, other not found/
  );
});

test("large tool schemas stream bounded JSON chunks without invoking the implementation", async () => {
  const description = '界,[]{}"\\'.repeat(32768);
  const tool = {
    name: "large",
    inputSchema: { description, nested: [{}, [], { value: "quoted , : [ ]" }] },
    implementation: () => {
      throw new Error("must not run");
    }
  };
  let stdout = "",
    maximum = 0;
  const result = await createLlmCommand({ tools: createLlmToolRegistry([tool]) }).execute({
    command: "llm",
    args: ["tools", "--json"],
    fs: new MemoryFileSystem(),
    cwd: "/",
    env: {},
    signal: new AbortController().signal,
    stdin: {
      [Symbol.asyncIterator]() {
        throw new Error("must not read");
      }
    },
    stdout: {
      async write(bytes) {
        maximum = Math.max(maximum, bytes.length);
        stdout += new TextDecoder().decode(bytes);
      }
    },
    stderr: {
      async write() {
        assert.fail("unexpected diagnostic");
      }
    }
  });
  assert.equal(result.exitCode, 0);
  assert.ok(maximum <= 4096);
  assert.deepEqual(JSON.parse(stdout), {
    tools: [{ name: "large", description: null, arguments: tool.inputSchema, plugin: null }],
    toolboxes: []
  });
});

test("tool catalog output obeys the command output limit", async () => {
  let emitted = 0,
    stderr = "";
  const result = await createLlmCommand({
    tools: createLlmToolRegistry([
      { name: "large", inputSchema: { description: "x".repeat(10000) } }
    ]),
    limits: { maxOutputBytes: 5000 }
  }).execute({
    command: "llm",
    args: ["tools", "--json"],
    fs: new MemoryFileSystem(),
    cwd: "/",
    env: {},
    signal: new AbortController().signal,
    stdin: {
      [Symbol.asyncIterator]() {
        throw new Error("must not read");
      }
    },
    stdout: {
      async write(bytes) {
        emitted += bytes.length;
      }
    },
    stderr: {
      async write(bytes) {
        stderr += new TextDecoder().decode(bytes);
      }
    }
  });
  assert.equal(result.exitCode, 1);
  assert.ok(emitted <= 5000);
  assert.match(stderr, /output byte limit exceeded/);
});

test("cancelling catalog output stops further writes", async () => {
  const controller = new AbortController(),
    failure = new Error("stop catalog");
  let writes = 0;
  await assert.rejects(
    async () => createLlmCommand({
      tools: createLlmToolRegistry([
        { name: "large", inputSchema: { description: "x".repeat(10000) } }
      ])
    }).execute({
      command: "llm",
      args: ["tools", "--json"],
      fs: new MemoryFileSystem(),
      cwd: "/",
      env: {},
      signal: controller.signal,
      stdin: {
        [Symbol.asyncIterator]() {
          throw new Error("must not read");
        }
      },
      stdout: {
        async write() {
          writes++;
          controller.abort(failure);
        }
      },
      stderr: { async write() {} }
    }),
    (error) => error === failure
  );
  assert.equal(writes, 1);
});

test("empty catalogs and code-point ordering remain deterministic", async () => {
  for (const tools of [
    createLlmToolRegistry([]),
    createLlmToolRegistry([
      { name: "𐀀", inputSchema: {} },
      { name: "\ue000", inputSchema: {} }
    ])
  ]) {
    let stdout = "";
    const result = await createLlmCommand({ tools }).execute({
      command: "llm",
      args: ["tools", "--json"],
      fs: new MemoryFileSystem(),
      cwd: "/",
      env: {},
      signal: new AbortController().signal,
      stdin: {
        [Symbol.asyncIterator]() {
          throw new Error("must not read");
        }
      },
      stdout: {
        async write(bytes) {
          stdout += new TextDecoder().decode(bytes);
        }
      },
      stderr: { async write() {} }
    });
    assert.equal(result.exitCode, 0);
    assert.deepEqual(
      JSON.parse(stdout).tools.map((tool: { name: string }) => tool.name),
      tools.size ? ["\ue000", "𐀀"] : []
    );
  }
});

test("selected registrations execute through the shared SDK with caller capabilities", async () => {
  const fs = new MemoryFileSystem();
  await fs.writeFile('/city', new TextEncoder().encode('Zürich'));
  const registry = createLlmToolRegistry([{
    name:'lookup',inputSchema:{type:'object'},signature:'()',
    async implementation(_args, context) {
      assert.equal(context.fs,fs);
      return {output:new TextDecoder().decode(await context.fs.readFile('/city'))};
    }
  }]);
  let output='';
  await executeLlmToolCalls({tools:selectLlmTools(registry,['lookup']),calls:[{name:'lookup',arguments:{}}],context:{fs,cwd:'/',signal:new AbortController().signal}},async result=>{
    for await(const bytes of result.output.bytes)output+=new TextDecoder().decode(bytes);
  });
  assert.equal(output,'Zürich');
});
