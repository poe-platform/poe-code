import { test } from "node:test";
import assert from "node:assert/strict";
import { AgentHost as own } from "../dist/agent-host.js";
import { AgentHost as reference } from "../../poe-agent/dist/runtime/agent-host.js";
import { createRunContext as ownContext } from "../dist/run-context.js";
import { createRunContext as referenceContext } from "../../poe-agent/dist/runtime/run-context.js";
const implementations = [
  [reference, referenceContext],
  [own, ownContext]
];
const neverModel = {
  async complete() {
    throw Error("Unexpected model call");
  }
};

test("tool classification reads type without an emitter but defers payload access until emission", async () => {
  for (const fail of [false, true]) {
    const results = [];
    for (const [Host, create] of implementations) {
      const reads = [],
        context = create();
      context.tools.register({
        name: "event",
        async *call() {
          yield {
            get type() {
              reads.push("type");
              if (fail) throw "classification failure";
              return "message.delta";
            },
            get content() {
              reads.push("content");
              throw "no payload reader";
            }
          };
          return "owned";
        }
      });
      const host = new Host({
        runContext: context,
        model: neverModel,
        createSpawnSession() {
          throw Error("no spawn");
        }
      });
      results.push({
        result: await host.handle({ intentId: "call", tool: "event", args: {} }),
        reads
      });
      await context.dispose();
    }
    assert.deepEqual(results[1], results[0]);
  }
});

function turn(notifications, cause) {
  return Object.assign(
    (async function* () {
      yield* notifications;
      if (cause !== undefined) throw cause;
    })(),
    { response: Promise.resolve({ stopReason: "completed" }) }
  );
}
test("spawn copies UTF16 chunks with default concatenation hints and original getter order", async () => {
  const results = [];
  for (const [Host, create] of implementations) {
    const reads = [],
      context = create();
    context.abortController.abort("parent already aborted");
    let content = 0;
    const update = {
      get sessionUpdate() {
        reads.push("sessionUpdate");
        return "agent_message_chunk";
      },
      get content() {
        reads.push("content");
        return content++ === 0
          ? {
              get type() {
                reads.push("type");
                return "text";
              }
            }
          : {
              get text() {
                reads.push("text");
                return {
                  valueOf() {
                    reads.push("valueOf");
                    return "🌍\ud800";
                  },
                  toString() {
                    throw Error("Wrong coercion hint");
                  }
                };
              }
            };
      }
    };
    const client = {
      async initialize() {
        reads.push("initialize");
      },
      async newSession(cwd, servers) {
        reads.push([cwd, servers]);
        return { sessionId: "child" };
      },
      prompt(id, blocks) {
        reads.push([id, blocks]);
        return turn([
          {
            params: {
              update: {
                sessionUpdate: "user_message_chunk",
                content: { type: "text", text: "ignore" }
              }
            }
          },
          {
            get params() {
              reads.push("params");
              return {
                get update() {
                  reads.push("update");
                  return update;
                }
              };
            }
          },
          {
            params: {
              update: {
                sessionUpdate: "agent_message_chunk",
                content: { type: "image", data: "ignore" }
              }
            }
          }
        ]);
      },
      async dispose() {
        reads.push("dispose");
      }
    };
    const host = new Host({
      runContext: context,
      model: neverModel,
      createSpawnSession() {
        reads.push("create");
        return { client, cwd: "/owned", mcpServers: [] };
      }
    });
    results.push({ output: await host.spawn("request"), reads });
  }
  assert.deepEqual(results[1], results[0]);
});

test("spawn always disposes and preserves arbitrary iteration/coercion/disposal causes", async () => {
  for (const cause of [null, false, 0, "", { failed: true }])
    for (const stage of ["stream", "coercion", "dispose"]) {
      const results = [];
      for (const [Host, create] of implementations) {
        let disposed = 0;
        const notification = {
          params: {
            update: {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text:
                  stage === "coercion"
                    ? {
                        valueOf() {
                          throw cause;
                        }
                      }
                    : "owned"
              }
            }
          }
        };
        const client = {
          async initialize() {},
          async newSession() {
            return { sessionId: "child" };
          },
          prompt() {
            return turn([notification], stage === "stream" ? cause : undefined);
          },
          async dispose() {
            disposed++;
            if (stage === "dispose") throw cause;
          }
        };
        const host = new Host({
          runContext: create(),
          model: neverModel,
          createSpawnSession() {
            return { client, cwd: "/owned" };
          }
        });
        await assert.rejects(host.spawn("request"), (error) => error === cause);
        results.push(disposed);
      }
      assert.deepEqual(results, [1, 1]);
    }
});

test("tool stream property ordering and emitter failure causes match the original", async () => {
  for (const cause of [undefined, null, false, 0, "", { failed: true }]) {
    const results = [];
    for (const [Host, create] of implementations) {
      const reads = [],
        context = create();
      context.tools.register({
        name: "event",
        async *call() {
          yield {
            get type() {
              reads.push("type");
              return "message.delta";
            },
            get content() {
              reads.push("content");
              return "🌍\ud800";
            }
          };
          yield {
            get type() {
              reads.push("type");
              return "progress";
            },
            get message() {
              reads.push("message");
              return "owned";
            }
          };
          return { owned: true };
        }
      });
      const host = new Host({
        runContext: context,
        model: neverModel,
        emit(event) {
          reads.push(event);
          if (cause !== undefined) throw cause;
        },
        createSpawnSession() {
          throw Error("no spawn");
        }
      });
      results.push({
        result: await host.handle({ intentId: "call", tool: "event", args: {} }),
        reads
      });
      await context.dispose();
    }
    assert.deepEqual(results[1], results[0]);
  }
});
