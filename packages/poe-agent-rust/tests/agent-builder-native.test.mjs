import { getEventListeners } from "node:events";
import { test } from "node:test";
import assert from "node:assert/strict";
import { agent, createAgentSession, createInMemorySpawnSession } from "../dist/index.js";
const response = (text) => ({
  events: (async function* () {
    yield { type: "text", text };
    yield { type: "stop", reason: "end_turn" };
  })()
});
const model = { complete: async () => response("hello") };
test("public immutable builders run and stream an injected model without external imports", async () => {
  const base = agent(),
    configured = base.model("x");
  assert.notEqual(base, configured);
  assert.equal((await configured.run("go", { acpModel: model })).output, "hello");
  assert.equal((await base.run("go", { acpModel: model })).exitCode, 0);
  const events = [];
  for await (const event of configured.stream("go", { acpModel: model })) events.push(event);
  assert.equal(events.at(-1).type, "session.complete");
});
test("owned persistent-session adapter resumes, navigates, forks and disposes in memory", async () => {
  const requests = [];
  const session = await createAgentSession({
    model: "x",
    plugins: [
      {
        name: "model",
        providers: [
          {
            name: "x",
            supports: () => true,
            createModel: () => ({
              complete: async (request) => {
                requests.push(request.messages);
                return response("hello");
              }
            })
          }
        ]
      }
    ]
  });
  assert.deepEqual(await session.sendMessage("one"), { role: "assistant", content: "hello" });
  assert.deepEqual(await session.sendMessage("two"), { role: "assistant", content: "hello" });
  const entries = session.tree();
  assert.equal(entries.length, 4);
  await session.navigateTo(entries[0].id);
  await session.sendMessage("branch");
  assert.equal(session.tree().at(-2).parentId, entries[0].id);
  const fork = await session.fork(entries[1].id);
  await fork.sendMessage("fork");
  assert.equal(
    fork.tree().some((e) => e.kind === "fork_marker"),
    true
  );
  assert.equal(requests.length, 4);
  await fork.dispose();
  await session.dispose();
  await assert.rejects(session.sendMessage("late"), /disposed/);
});
test("owned in-memory ACP default adapter invokes injected session and disposes it", async () => {
  let disposed = 0;
  const spawn = createInMemorySpawnSession({
    model: "x",
    cwd: "/tmp",
    createSession: async () => ({
      sendMessage: async () => ({ role: "assistant", content: "child" }),
      dispose: async () => {
        disposed++;
      }
    })
  });
  await spawn.client.initialize();
  const session = await spawn.client.newSession("/tmp", []);
  const turn = spawn.client.prompt(session.sessionId, [{ type: "text", text: "go" }]);
  const updates = [];
  for await (const update of turn) updates.push(update);
  assert.equal(updates[0].params.update.content.text, "child");
  assert.equal((await turn.response).stopReason, "completed");
  await spawn.client.dispose();
  assert.equal(disposed, 1);
});

test("caller acknowledgement rejects unknown and duplicate acknowledgements and releases abort listeners", async () => {
  const tools = {
    complete: async () => ({
      events: (async function* () {
        yield { type: "tool_use_complete", id: "tool-1", name: "echo", args: {} };
        yield { type: "stop", reason: "tool_use" };
      })()
    })
  };
  const controller = new AbortController();
  const session = await agent()
    .tools({
      name: "echo",
      inputSchema: {},
      call: async function* () {
        throw Error("caller handles");
      }
    })
    .acp("go", { acpModel: tools, signal: controller.signal, maxIterations: 1 });
  const iterator = session.events[Symbol.asyncIterator]();
  let intent;
  while (!intent) {
    const event = await iterator.next();
    assert.equal(event.done, false);
    if (event.value.type === "tool.intent") intent = event.value;
  }
  assert.throws(
    () => session.acknowledge("unknown", { status: "success", result: "x" }),
    /Unknown or already/
  );
  // Advancing begins host.handle; acknowledge only once the intent is pending.
  const pending = iterator.next();
  await new Promise((resolve) => setImmediate(resolve));
  session.acknowledge(intent.intentId, { status: "success", result: "ok" });
  assert.throws(
    () => session.acknowledge(intent.intentId, { status: "success", result: "again" }),
    /Unknown or already/
  );
  assert.equal((await pending).value.type, "tool.result");
  await iterator.return();
  await session.dispose();
  assert.equal(getEventListeners(controller.signal, "abort").length, 0);
});

test("in-memory transport disposal rejects late requests and retires asynchronously created sessions", async () => {
  const { createInMemoryAcpTransport } = await import("../dist/index.js");
  let resolveSession,
    disposed = 0;
  const transport = createInMemoryAcpTransport({
    model: "x",
    cwd: "/tmp",
    createSession: () =>
      new Promise((resolve) => {
        resolveSession = resolve;
      })
  });
  const creation = transport.sendRequest("session/new", {});
  transport.dispose();
  resolveSession({
    sendMessage: async () => ({ role: "assistant", content: "late" }),
    dispose: async () => {
      disposed++;
    }
  });
  await assert.rejects(creation, /disposed/);
  await transport.closed;
  assert.equal(disposed, 1);
  await assert.rejects(transport.sendRequest("initialize", {}), /disposed/);
});

test("in-memory transport reports disposal rejection through closed without an unhandled promise", async () => {
  const { createInMemoryAcpTransport } = await import("../dist/index.js");
  const failure = Error("dispose failed");
  const transport = createInMemoryAcpTransport({
    model: "x",
    cwd: "/tmp",
    createSession: async () => ({
      sendMessage: async () => ({ role: "assistant", content: "x" }),
      dispose: async () => {
        throw failure;
      }
    })
  });
  await transport.sendRequest("session/new", {});
  transport.dispose();
  const closed = await transport.closed;
  assert.equal(closed.reason, failure);
  await new Promise((resolve) => setImmediate(resolve));
});

test("in-memory transport awaits notification callbacks and propagates their errors", async () => {
  const { createInMemoryAcpTransport } = await import("../dist/index.js");
  const transport = createInMemoryAcpTransport({
    model: "x",
    cwd: "/tmp",
    createSession: async () => ({
      sendMessage: async () => ({ role: "assistant", content: "x" }),
      dispose: async () => {}
    })
  });
  const { sessionId } = await transport.sendRequest("session/new", {});
  const failure = Error("notification failed");
  transport.onNotification("session/update", async () => {
    throw failure;
  });
  await assert.rejects(
    transport.sendRequest("session/prompt", { sessionId, prompt: [{ type: "text", text: "go" }] }),
    (error) => error === failure
  );
  transport.dispose();
  await transport.closed;
});

test("disposed in-flight child prompts do not emit completion notifications", async () => {
  const { createInMemoryAcpTransport } = await import("../dist/index.js");
  let complete,
    notifications = 0;
  const transport = createInMemoryAcpTransport({
    model: "x",
    cwd: "/tmp",
    createSession: async () => ({
      sendMessage: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      dispose: async () => {}
    })
  });
  const { sessionId } = await transport.sendRequest("session/new", {});
  transport.onNotification("session/update", () => {
    notifications++;
  });
  const turn = transport.sendRequest("session/prompt", { sessionId, prompt: [] });
  transport.dispose();
  complete({ role: "assistant", content: "late" });
  await assert.rejects(turn, /disposed/);
  assert.equal(notifications, 0);
  await transport.closed;
});

test("seeded public builder results match original tools, usage, resume and failures", async () => {
  const reference = await import("../../poe-agent/dist/agent.js");
  const makeModel = (scenario) => {
    let calls = 0;
    return {
      complete: async () => {
        if (scenario % 7 === 0) throw new Error("model failed " + scenario);
        const events = [];
        if (calls++ === 0 && scenario % 2 === 0)
          events.push({
            type: "tool_use_complete",
            id: "opaque 🌍\ud800",
            name: "echo",
            args: { scenario }
          });
        else events.push({ type: "text", text: "done 🌍\ud800 " + scenario });
        events.push(
          {
            type: "usage",
            inputTokens: scenario + 20,
            outputTokens: scenario + 1,
            cachedTokens: 4,
            cacheCreationTokens: 2
          },
          { type: "stop", reason: events[0].type === "tool_use_complete" ? "tool_use" : "end_turn" }
        );
        return {
          events: (async function* () {
            yield* events;
          })()
        };
      }
    };
  };
  for (let scenario = 0; scenario < 96; scenario++) {
    const run = async (factory) => {
      let disposed = 0;
      const builder = factory()
        .model("x")
        .use({
          name: "tool",
          tools: [
            {
              name: "echo",
              inputSchema: {},
              call: async (args) => {
                if (scenario % 3 === 0) throw Error("tool failed");
                return args;
              }
            }
          ],
          dispose: () => {
            disposed++;
          }
        });
      const chunks = [];
      const result = await builder.run("go", {
        acpModel: makeModel(scenario),
        maxIterations: 3,
        resume: { messages: [{ role: "assistant", content: "before" }] },
        onStdout: (chunk) => chunks.push(chunk)
      });
      return { result, chunks, disposed };
    };
    assert.deepEqual(await run(agent), await run(reference.agent), "scenario " + scenario);
  }
});
