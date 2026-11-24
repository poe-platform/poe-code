import { agent } from "./agent.js";
import { describe, expect, it } from "vitest";
import { createAgentSession } from "./agent-session.js";
import type { AcpModel, AcpModelRequestMessage } from "./runtime/acp-core.js";
import type { ProviderStreamEvent } from "./runtime/plugin-types.js";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function response(events: ProviderStreamEvent[]) {
  return {
    events: {
      async *[Symbol.asyncIterator]() {
        yield* events;
      }
    }
  };
}
function session(complete: AcpModel["complete"]) {
  return createAgentSession({
    model: "test",
    plugins: [
      {
        name: "test",
        providers: [{ name: "test", supports: () => true, createModel: () => ({ complete }) }]
      }
    ]
  });
}

describe("session input controls", () => {
  it("serializes queued turns and includes the preceding answer", async () => {
    const started = deferred<void>(),
      finish = deferred<void>();
    const requests: AcpModelRequestMessage[][] = [];
    const s = await session(async ({ messages }) => {
      requests.push(messages);
      if (requests.length === 1) {
        started.resolve();
        await finish.promise;
      }
      return response([
        { type: "text", text: requests.length === 1 ? "first answer" : "second answer" }
      ]);
    });
    const first = s.sendMessage("first");
    await started.promise;
    const second = s.sendMessage("second", { mode: "queue" });
    await Promise.resolve();
    expect(requests).toHaveLength(1);
    finish.resolve();
    await Promise.all([first, second]);
    expect(requests[1].filter((m) => m.role !== "system").map((m) => m.content)).toEqual([
      "first",
      "first answer",
      "second"
    ]);
    await s.dispose();
  });

  it("interrupts inference, preserves queued turns, and ignores late output", async () => {
    const started = deferred<AbortSignal>(),
      late = deferred<void>();
    const prompts: string[] = [];
    const s = await session(async ({ messages, signal }) => {
      prompts.push(messages.filter((m) => m.role === "user").at(-1)!.content as string);
      if (prompts.length === 1) {
        started.resolve(signal);
        await late.promise;
      }
      return response([{ type: "text", text: "answer" }]);
    });
    const first = s.sendMessage("first").catch((e) => e);
    const signal = await started.promise;
    const queued = s.sendMessage("queued", { mode: "queue" });
    const next = s.sendMessage("interrupt", { mode: "interrupt" });
    expect(signal.aborted).toBe(true);
    expect(await first).toBeInstanceOf(Error);
    await next;
    await queued;
    expect(prompts).toEqual(["first", "interrupt", "queued"]);
    late.resolve();
    await s.dispose();
  });

  it("injects a follow-up after inference before starting proposed tools", async () => {
    const started = deferred<void>(),
      finish = deferred<void>();
    let calls = 0;
    const requests: AcpModelRequestMessage[][] = [];
    const s = await session(async ({ messages }) => {
      requests.push(messages);
      if (++calls === 1) {
        started.resolve();
        await finish.promise;
        return response([{ type: "tool_use_complete", id: "tool1", name: "missing", args: {} }]);
      }
      return response([{ type: "text", text: "redirected" }]);
    });
    const first = s.sendMessage("first");
    await started.promise;
    const follow = s.sendMessage("correction", { mode: "follow-up" });
    finish.resolve();
    expect((await first).content).toBe("redirected");
    expect((await follow).content).toBe("redirected");
    expect(requests[1].at(-1)).toMatchObject({ role: "user", content: "correction" });
    expect(requests[1].some((m) => m.role === "tool" && m.tool_call_id === "tool1")).toBe(true);
    expect(
      s
        .tree()
        .filter((e) => e.kind === "user")
        .map((e) => e.text)
    ).toEqual(["first", "correction"]);
    await s.dispose();
  });

  it("cancels active and queued messages, then accepts a fresh turn", async () => {
    const started = deferred<void>();
    let calls = 0;
    const s = await session(async () => {
      if (++calls === 1) {
        started.resolve();
        return await new Promise(() => {});
      }
      return response([{ type: "text", text: "fresh" }]);
    });
    const active = s.sendMessage("first").catch((e) => e);
    await started.promise;
    const queued = s.sendMessage("queued").catch((e) => e);
    await s.cancel();
    expect(await active).toBeInstanceOf(Error);
    expect(await queued).toBeInstanceOf(Error);
    expect((await s.sendMessage("fresh")).content).toBe("fresh");
    await s.dispose();
  });
  it("drops a stalled provider stream and asks its iterator to close", async () => {
    const started = deferred<AbortSignal>();
    let closed = false;
    const s = await session(async ({ signal }) => ({
      events: {
        [Symbol.asyncIterator]() {
          return {
            next() {
              started.resolve(signal);
              return new Promise<IteratorResult<ProviderStreamEvent>>(() => {});
            },
            async return() {
              closed = true;
              return { done: true as const, value: undefined };
            }
          };
        }
      }
    }));
    const result = s.sendMessage("first").catch((e) => e);
    const signal = await started.promise;
    await s.cancel();
    expect(signal.aborted).toBe(true);
    expect(await result).toBeInstanceOf(Error);
    expect(closed).toBe(true);
    await s.dispose();
  });

  it("removes an aborted queued input without cancelling the active turn", async () => {
    const started = deferred<void>(),
      finish = deferred<void>();
    let calls = 0;
    const s = await session(async ({ signal }) => {
      calls++;
      started.resolve();
      await finish.promise;
      expect(signal.aborted).toBe(false);
      return response([{ type: "text", text: "done" }]);
    });
    const first = s.sendMessage("first");
    await started.promise;
    const controller = new AbortController();
    const queued = s.sendMessage("queued", { signal: controller.signal }).catch((e) => e);
    controller.abort();
    expect(await queued).toBeInstanceOf(Error);
    finish.resolve();
    await first;
    expect(calls).toBe(1);
    await s.dispose();
  });

  it("uses the next tool boundary and skips the remaining batch", async () => {
    const started = deferred<void>(),
      finish = deferred<void>();
    let secondCalls = 0,
      completions = 0;
    const requests: AcpModelRequestMessage[][] = [];
    const s = await createAgentSession({
      model: "test",
      plugins: [
        {
          name: "test",
          providers: [
            {
              name: "test",
              supports: () => true,
              createModel: () => ({
                complete: async ({ messages }) => {
                  requests.push(messages);
                  return response(
                    ++completions === 1
                      ? [
                          { type: "tool_use_complete", id: "one", name: "first", args: {} },
                          { type: "tool_use_complete", id: "two", name: "second", args: {} }
                        ]
                      : [{ type: "text", text: "redirected" }]
                  );
                }
              })
            }
          ],
          tools: [
            {
              name: "first",
              call: async () => {
                started.resolve();
                await finish.promise;
                return "done";
              }
            },
            {
              name: "second",
              call: () => {
                secondCalls++;
                return "wrong";
              }
            }
          ]
        }
      ]
    });
    const first = s.sendMessage("first");
    await started.promise;
    const follow = s.sendMessage("correction", { mode: "follow-up" });
    expect(completions).toBe(1);
    finish.resolve();
    await Promise.all([first, follow]);
    expect(secondCalls).toBe(0);
    expect(requests[1].at(-1)).toMatchObject({ role: "user", content: "correction" });
    expect(s.getHistory().filter((m) => m.role === "tool")).toHaveLength(2);
    await s.dispose();
  });

  it("interrupts a tool and repairs every outstanding call before resuming", async () => {
    const started = deferred<void>();
    let completions = 0;
    const requests: AcpModelRequestMessage[][] = [];
    const s = await createAgentSession({
      model: "test",
      plugins: [
        {
          name: "test",
          providers: [
            {
              name: "test",
              supports: () => true,
              createModel: () => ({
                complete: async ({ messages }) => {
                  requests.push(messages);
                  return response(
                    ++completions === 1
                      ? [
                          { type: "tool_use_complete", id: "one", name: "first", args: {} },
                          { type: "tool_use_complete", id: "two", name: "first", args: {} }
                        ]
                      : [{ type: "text", text: "interrupted" }]
                  );
                }
              })
            }
          ],
          tools: [
            {
              name: "first",
              call: async () => {
                started.resolve();
                return await new Promise(() => {});
              }
            }
          ]
        }
      ]
    });
    const first = s.sendMessage("first").catch((e) => e);
    await started.promise;
    await s.sendMessage("replacement", { mode: "interrupt" });
    expect(await first).toBeInstanceOf(Error);
    const messages = requests[1];
    const calls = messages.flatMap((m) => m.tool_calls ?? []);
    expect(calls.map((c) => c.id)).toEqual(["one", "two"]);
    expect(messages.filter((m) => m.role === "tool").map((m) => m.tool_call_id)).toEqual([
      "one",
      "two"
    ]);
    await s.dispose();
  });

  it("queues follow-up input arriving during final cleanup", async () => {
    const cleaning = deferred<void>(),
      release = deferred<void>();
    let disposals = 0,
      calls = 0;
    const s = await createAgentSession({
      model: "test",
      plugins: [
        {
          name: "test",
          providers: [
            {
              name: "test",
              supports: () => true,
              createModel: () => ({
                complete: async () => response([{ type: "text", text: String(++calls) }])
              })
            }
          ],
          async dispose() {
            if (++disposals === 1) {
              cleaning.resolve();
              await release.promise;
            }
          }
        }
      ]
    });
    const first = s.sendMessage("first");
    await cleaning.promise;
    const follow = s.sendMessage("after cleanup", { mode: "follow-up" });
    release.resolve();
    expect((await first).content).toBe("1");
    expect((await follow).content).toBe("2");
    expect(
      s
        .tree()
        .filter((e) => e.kind === "user")
        .map((e) => e.text)
    ).toEqual(["first", "after cleanup"]);
    await s.dispose();
  });

  it("cancels during provider setup without waiting for that provider", async () => {
    const started = deferred<void>(),
      late = deferred<void>();
    let models = 0,
      calls = 0;
    const s = await createAgentSession({
      model: "test",
      plugins: [
        {
          name: "test",
          providers: [
            {
              name: "test",
              supports: () => true,
              createModel: async () => {
                if (++models === 1) {
                  started.resolve();
                  await late.promise;
                }
                return {
                  complete: async () => {
                    calls++;
                    return response([{ type: "text", text: "fresh" }]);
                  }
                };
              }
            }
          ]
        }
      ]
    });
    const first = s.sendMessage("first").catch((e) => e);
    await started.promise;
    await s.cancel();
    expect(await first).toBeInstanceOf(Error);
    expect((await s.sendMessage("fresh")).content).toBe("fresh");
    late.resolve();
    await Promise.resolve();
    expect(calls).toBe(1);
    await s.dispose();
  });

  it("saves follow-up messages in one ordered history branch with prior output", async () => {
    const started = deferred<void>(),
      finish = deferred<void>();
    let calls = 0;
    const s = await session(async () => {
      if (++calls === 1) {
        started.resolve();
        await finish.promise;
      }
      return response([{ type: "text", text: calls === 1 ? "Initial reply" : "Corrected reply" }]);
    });
    const first = s.sendMessage("first");
    await started.promise;
    const follow = s.sendMessage("correction", { mode: "follow-up" });
    finish.resolve();
    await Promise.all([first, follow]);
    const tree = s.tree();
    expect(tree.map((e) => ("text" in e ? e.text : e.kind))).toEqual([
      "first",
      "Initial reply",
      "correction",
      "Corrected reply"
    ]);
    for (let i = 1; i < tree.length; i++) expect(tree[i].parentId).toBe(tree[i - 1].id);
    await s.dispose();
  });
  it("never emits executable intents for tools skipped by a follow-up", async () => {
    const started = deferred<void>(),
      finish = deferred<void>();
    let calls = 0;
    const acp = await agent()
      .model("test")
      .acp("first", {
        acpModel: {
          complete: async () => {
            if (++calls === 1) {
              started.resolve();
              await finish.promise;
              return response([
                {
                  type: "tool_use_complete",
                  id: "skipped",
                  name: "shell",
                  args: { command: "never run" }
                }
              ]);
            }
            return response([{ type: "text", text: "redirected" }]);
          }
        }
      });
    await started.promise;
    expect(acp.followUp("correction")).toBe(true);
    finish.resolve();
    const events = [];
    for await (const event of acp.events) events.push(event);
    expect(events.some((e) => e.type === "tool.intent")).toBe(false);
    expect(events.find((e) => e.type === "tool.error")).toMatchObject({
      intentId: "skipped",
      tool: "shell",
      args: { command: "never run" }
    });
    expect(acp.followUp("too late")).toBe(false);
    await acp.dispose();
  });
  it("closes tool activity when interrupted during a partial provider stream", async () => {
    const started = deferred<void>();
    const acp = await agent()
      .model("test")
      .acp("first", {
        acpModel: {
          complete: async () => ({
            events: {
              async *[Symbol.asyncIterator]() {
                yield {
                  type: "tool_use_delta" as const,
                  id: "partial",
                  name: "shell",
                  argsDelta: "{}"
                };
                started.resolve();
                await new Promise(() => {});
              }
            }
          })
        }
      });
    await started.promise;
    acp.cancel();
    const events = [];
    for await (const event of acp.events) events.push(event);
    expect(events.map((e) => e.type)).toEqual(["tool.intent", "tool.error", "session.error"]);
    await acp.dispose();
  });
});
