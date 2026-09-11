import { expect, it } from "vitest";
import { dump, run } from "../index.js";
import type { RunSnapshot } from "../run.js";
import { HostCallJournal } from "./host-call.js";
import { PromiseReplay, promiseReplayContext } from "./promise-replay.js";

it("rejects an unreachable scheduled imported Promise before replay starts", async () => {
  const source = "return await (await load()).nested";
  const result = await run(source, { bindings: { load: async () => ({ nested: Promise.resolve(7) }) } });
  expect(result).toMatchObject({ ok: true, returnValue: 7 });
  const snapshot = JSON.parse(await dump(result)) as RunSnapshot;
  const outcome = snapshot.replay!.calls.find(call => call.outcome?.data.nodes.some(
    node => node.kind === "settled-imported-promise" && node.scheduleId !== undefined
  ))!.outcome!;
  outcome.data.root = null;
  const scheduling = new PromiseReplay(snapshot.promiseReplay);
  expect(() => promiseReplayContext.run(scheduling, () =>
    new HostCallJournal(snapshot.sourceHash, [], undefined, snapshot.replay)
  )).toThrow(/scheduling|unreachable/i);
});

it.each(["removed", "outer-id", "out-of-range", "duplicate"] as const)(
  "rejects %s imported scheduling metadata before replay starts", async mutation => {
    const source = "return await (await load()).nested";
    const result = await run(source, { bindings: { load: async () => ({ nested: Promise.resolve(7) }) } });
    expect(result).toMatchObject({ ok: true, returnValue: 7 });
    const snapshot = JSON.parse(await dump(result)) as RunSnapshot;
    const outcome = snapshot.replay!.calls.find(call => call.outcome?.data.nodes.some(
      node => node.kind === "settled-imported-promise" && node.scheduleId !== undefined
    ))!.outcome!;
    const node = outcome.data.nodes.find(node => node.kind === "settled-imported-promise")!;
    if (node.kind !== "settled-imported-promise") throw new Error("Expected imported Promise");
    expect(node.scheduleId).toBe(2);
    if (mutation === "removed") delete node.scheduleId;
    if (mutation === "outer-id") node.scheduleId = 1;
    if (mutation === "out-of-range") node.scheduleId = snapshot.promiseReplay!.promises + 1;
    if (mutation === "duplicate") outcome.data.nodes.push(structuredClone(node));
    const scheduling = new PromiseReplay(snapshot.promiseReplay);
    expect(() => promiseReplayContext.run(scheduling, () =>
      new HostCallJournal(snapshot.sourceHash, [], undefined, snapshot.replay)
    )).toThrow(/scheduling/i);
  }
);
