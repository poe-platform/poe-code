import { describe, expect, it } from "vitest";
import { agent } from "./agent.js";
import { createAgentSession } from "./agent-session.js";
import spawnPlugin from "./plugins/poe-agent-plugin-spawn.js";
import type { AcpModel } from "./runtime/acp-core.js";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function response(text: string) {
  return {
    events: {
      async *[Symbol.asyncIterator]() {
        yield { type: "text" as const, text };
      }
    }
  };
}
function options(complete: AcpModel["complete"]) {
  return {
    model: "test",
    plugins: [
      {
        name: "test",
        providers: [{ name: "test", supports: () => true, createModel: () => ({ complete }) }]
      }
    ]
  };
}

describe("asynchronous session delegation", () => {
  it("returns an ID immediately and wakes an idle parent with the result", async () => {
    const started = deferred(),
      finish = deferred();
    const requests: string[][] = [];
    const s = await createAgentSession(
      options(async ({ messages }) => {
        const input = messages.filter((m) => m.role === "user").map((m) => m.content as string);
        requests.push(input);
        if (input.at(-1) === "child") {
          started.resolve();
          await finish.promise;
          return response("child answer");
        }
        return response("parent answer");
      })
    );
    const id = await s.delegate("child");
    await started.promise;
    await s.sendMessage("parent");
    expect(requests).toHaveLength(2);
    finish.resolve();
    await s.whenIdle();
    const delivery = JSON.parse(requests.at(-1)!.at(-1)!);
    expect(delivery).toEqual({ delegation: id, status: "completed", output: "child answer" });
    expect(s.getHistory().at(-1)?.content).toBe("parent answer");
    await s.dispose();
  });

  it("forks a snapshot of parent history and keeps fresh spawns independent", async () => {
    const inputs: string[][] = [];
    const s = await createAgentSession(
      options(async ({ messages }) => {
        inputs.push(messages.filter((m) => m.role === "user").map((m) => m.content as string));
        return response("done");
      })
    );
    await s.sendMessage("parent context");
    await s.delegate("fork task", { fork: true });
    await s.whenIdle();
    await s.delegate("fresh task");
    await s.whenIdle();
    expect(inputs.find((i) => i.at(-1) === "fork task")).toContain("parent context");
    expect(inputs.find((i) => i.at(-1) === "fresh task")).toEqual(["fresh task"]);
    await s.dispose();
  });

  it("delivers child failure and cancels owned children without waking a disposed session", async () => {
    const started = deferred(),
      stopped = deferred();
    let parentCalls = 0;
    const s = await createAgentSession(
      options(async ({ messages, signal }) => {
        if (messages.at(-1)?.content === "fail") throw Error("child failed");
        if (messages.at(-1)?.content === "wait") {
          started.resolve();
          signal.addEventListener("abort", stopped.resolve, { once: true });
          return new Promise(() => {});
        }
        parentCalls++;
        return response("handled");
      })
    );
    await s.delegate("fail");
    await s.whenIdle();
    expect(parentCalls).toBe(1);
    expect(
      s
        .getHistory()
        .some((m) => typeof m.content === "string" && m.content.includes("child failed"))
    ).toBe(true);
    await s.delegate("wait");
    await started.promise;
    await s.dispose();
    await stopped.promise;
    expect(parentCalls).toBe(1);
  });

  it("exposes only asynchronous spawn and fork delegation tools", async () => {
    const calls: unknown[] = [];
    const tools = spawnPlugin().tools!;
    expect(tools.map((t) => t.name)).toEqual(["spawn", "fork"]);
    for (const tool of tools) {
      const value = await tool.call({ task: "task" }, {
        delegate: async (...args: unknown[]) => {
          calls.push(args);
          return "task-id";
        }
      } as never);
      expect(JSON.parse(value as string)).toEqual({ id: "task-id", status: "running" });
    }
    expect(calls).toEqual([
      ["task", false],
      ["task", true]
    ]);
  });
  it("retains a delegated child until its own asynchronous children have reported back", async () => {
    const started = deferred(),
      finish = deferred();
    let parentResult;
    const config = options(async ({ messages }) => {
      const users = messages.filter((m) => m.role === "user").map((m) => m.content as string);
      if (users[0] === "grandchild") {
        started.resolve();
        await finish.promise;
        return response("grandchild answer");
      }
      if (users[0] === "child") {
        if (users.length > 1) return response("child final");
        if (messages.some((m) => m.role === "tool")) return response("child provisional");
        return {
          events: {
            async *[Symbol.asyncIterator]() {
              yield {
                type: "tool_use_complete" as const,
                id: "spawn",
                name: "spawn",
                args: { task: "grandchild" }
              };
            }
          }
        };
      }
      parentResult = JSON.parse(users.at(-1)!);
      return response("parent final");
    });
    const s = await createAgentSession({ ...config, plugins: [...config.plugins, spawnPlugin()] });
    const id = await s.delegate("child");
    await started.promise;
    expect(parentResult).toBeUndefined();
    finish.resolve();
    await s.whenIdle();
    expect(parentResult).toEqual({ delegation: id, status: "completed", output: "child final" });
    await s.dispose();
  });

  it("reports failure of an automatic follow-up through session quiescence", async () => {
    const s = await createAgentSession(
      options(async ({ messages }) => {
        if (messages.at(-1)?.content === "child") return response("done");
        throw Error("parent inference failed");
      })
    );
    await s.delegate("child");
    await expect(s.whenIdle()).rejects.toThrow("parent inference failed");
    await s.dispose();
  });
});

it("keeps one-shot fork owners alive through nested asynchronous delegation", async () => {
  const started = deferred(),
    finish = deferred();
  const complete: AcpModel["complete"] = async ({ messages }) => {
    const users = messages.filter((m) => m.role === "user").map((m) => m.content as string);
    const task = users.filter((text) => !text.startsWith("{")).at(-1)!;
    if (task === "grandchild") {
      started.resolve();
      await finish.promise;
      return response("grandchild final");
    }
    const latest = users.at(-1)!;
    if (latest.startsWith("{")) return response(task + " received " + JSON.parse(latest).output);
    const index = messages.map((m) => m.role).lastIndexOf("user");
    if (messages.slice(index + 1).some((m) => m.role === "tool"))
      return response(task + " provisional");
    return {
      events: {
        async *[Symbol.asyncIterator]() {
          yield {
            type: "tool_use_complete" as const,
            id: task,
            name: "fork",
            args: { task: task === "parent" ? "child" : "grandchild" }
          };
        }
      }
    };
  };
  const result = agent().model("test").use(spawnPlugin()).run("parent", { acpModel: { complete } });
  await started.promise;
  finish.resolve();
  expect((await result).output).toBe("parent received child received grandchild final");
});
