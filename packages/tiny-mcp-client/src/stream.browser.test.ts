import { expect, it } from "vitest";
import { PassThrough } from "./stream.browser.js";

it("preserves queued bytes, wakes readers, and drains before EOF", async () => {
  const stream = new PassThrough(), bytes = new Uint8Array([1, 2]);
  stream.write(bytes); bytes.fill(9);
  const iterator = stream[Symbol.asyncIterator]();
  expect((await iterator.next()).value).toEqual(new Uint8Array([1, 2]));
  const pending = iterator.next();
  stream.write("é"); stream.end();
  expect((await pending).value).toEqual(new TextEncoder().encode("é"));
  expect((await iterator.next()).done).toBe(true);
  expect(() => stream.write("late")).toThrow("closed");
});

it("propagates the original failure and closes once while a reader waits", async () => {
  const stream = new PassThrough(), reason = new Error("cancelled"), events: unknown[] = [];
  stream.once("error", error => events.push(error));
  stream.once("close", () => events.push("close"));
  const pending = stream[Symbol.asyncIterator]().next();
  stream.destroy(reason); stream.destroy(new Error("replacement"));
  await expect(pending).rejects.toBe(reason);
  expect(events).toEqual([reason, "close"]);
});
