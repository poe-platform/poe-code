import { expect, it, vi } from "vitest";
import * as api from "./index.js";
import { saveFixture } from "../tests/fixtures/save-output.js";
import { paragraph, textContext, textFixture } from "../tests/fixtures/text.js";

it.each(["stage", "write", "close", "commit", "abort", "borrowed"] as const)("captures %s without reading a method's bind accessor", async method => {
  const env = saveFixture(), model = await api.Document(await textFixture(paragraph("Method receiver")));
  const getter = vi.fn(() => { throw new Error("custom bind must not run"); });
  const selected = method === "stage" ? env.sink.stage : method === "borrowed"
    ? async (bytes: Uint8Array) => { env.volume.writeFileSync("/work/output", bytes); } : env.staged[method];
  Object.defineProperty(selected, "bind", { get: getter });
  await model.save(method === "borrowed" ? { write: selected as api.ArchiveSink["write"] } : env.sink);
  expect(getter).not.toHaveBeenCalled();
  expect((await api.Document(env.bytes())).paragraphs[0]!.text).toBe("Method receiver");
});

it.each(["write", "close", "commit"] as const)("preserves primary %s failure and settles abort before unlocking", async method => {
  const env = saveFixture(), model = await api.Document(await textFixture(paragraph("Failure ownership")));
  const cause = new Error("primary fault"), cleanup = new Error("cleanup fault");
  env.staged[method].mockRejectedValueOnce(cause);
  env.staged.abort.mockImplementationOnce(async () => {
    expect(() => model.add_paragraph("During cleanup")).toThrow(api.PublicationError);
    env.volume.rmSync("/work/stage");
    throw cleanup;
  });
  await expect(model.save(env.sink)).rejects.toMatchObject({ code: "sink-failure", cause, cleanupError: cleanup, published: [], stdoutMayBePartial: false });
  expect(env.staged.abort).toHaveBeenCalledTimes(1);
  expect(env.staged.close).toHaveBeenCalledTimes(method === "write" ? 0 : 1);
  expect(env.staged.commit).toHaveBeenCalledTimes(method === "commit" ? 1 : 0);
  expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
  model.add_paragraph("Retry after cleanup");
  await model.save(env.sink);
  expect((await api.Document(env.bytes())).paragraphs.map(p => p.text)).toEqual(["Failure ownership", "Retry after cleanup"]);
});

it("keeps later chunks and the model independent of sink-owned byte mutations", async () => {
  const env = saveFixture(), text = "Coastal measurements ".repeat(200);
  const model = await api.Document(await textFixture(paragraph(text)), textContext);
  const retained: Uint8Array[] = [];
  env.staged.write.mockImplementation(async chunk => {
    // A sink may retain or reuse ownership of each delivered chunk after copying it.
    for (const earlier of retained) earlier.fill(0xff);
    retained.push(chunk);
    env.volume.appendFileSync("/work/stage", chunk);
  });
  await model.save(env.sink);
  expect(retained.length).toBeGreaterThan(2);
  expect(new Set(retained.map(chunk => chunk.buffer)).size).toBe(retained.length);
  expect(retained.every(chunk => chunk.length <= textContext.limits.chunkSize)).toBe(true);
  expect((await api.Document(env.bytes())).paragraphs[0]!.text).toBe(text);
  expect(model.paragraphs[0]!.text).toBe(text);
});

it("keeps borrowed transport failure explicit and never calls its close or abort", async () => {
  const env = saveFixture(), model = await api.Document(await textFixture(paragraph("Borrowed stream")));
  const cause = new Error("pipe failed"), close = vi.fn(), abort = vi.fn();
  const sink = { close, abort, async write(bytes: Uint8Array) {
    env.volume.writeFileSync("/work/output", bytes.subarray(0, 3));
    throw cause;
  } };
  await expect(model.save(sink)).rejects.toMatchObject({ code: "sink-failure", cause, stdoutMayBePartial: true, published: [] });
  expect(env.bytes()).toHaveLength(3);
  expect(close).not.toHaveBeenCalled(); expect(abort).not.toHaveBeenCalled();
  model.add_paragraph("Unlocked after failure");
});

it("preserves cancellation and cleanup failure when commit rejects", async () => {
  const env = saveFixture(), controller = new AbortController();
  const model = await api.Document(await textFixture(paragraph("Cancelled commit")), { ...textContext, signal: controller.signal });
  const cause = new Error("commit interrupted"), cleanup = new Error("abort interrupted");
  env.staged.commit.mockImplementationOnce(async () => { controller.abort(); throw cause; });
  env.staged.abort.mockRejectedValueOnce(cleanup);
  await expect(model.save(env.sink)).rejects.toMatchObject({ code: "cancelled", cause, cleanupError: cleanup, published: [], stdoutMayBePartial: false });
  expect(env.staged.abort).toHaveBeenCalledTimes(1);
  expect(env.volume.readFileSync("/work/output", "utf8")).toBe("previous");
});
