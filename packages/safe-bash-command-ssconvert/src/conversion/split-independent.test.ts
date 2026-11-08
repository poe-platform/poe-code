import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, createResourceIO, runCommand, type Codec, type Workbook } from "../index.js";
import { splitOutput } from "./split.js";

function setup(sheetSelection = false) {
  const volume = Volume.fromJSON({ "/input": "original" });
  const original: Workbook = { activeSheet: "a", sheets: [
    { id: "a", name: "First", cells: [] }, { id: "b", name: "Second", cells: [] }
  ] };
  const saved: { order: string[]; active: string | undefined; selected: readonly string[] | undefined }[] = [];
  const codec: Codec = {
    id: "original", description: "Independent split fixture", extensions: ["csv"],
    saveScope: "sheet", sheetSelection, probeContent: () => true,
    async read() { return original; },
    async write(book, _options, _context, selection) {
      saved.push({ order: book.sheets.map(sheet => sheet.id), active: book.activeSheet, selected: selection?.sheets });
      return new TextEncoder().encode(selection?.sheets?.[0] ?? book.sheets[0]!.id);
    }
  };
  const config = {
    codecs: [codec], environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 10, operations: 10 },
    filesystem: createResourceIO({ cwd: "/", filesystem: {
      async read(path: string) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    } })
  };
  return { original, saved, config, volume };
}

const request = { input: { kind: "resource" as const, uri: "/input" }, exportType: "original", perSheet: true };

it.each([false, true])("preserves repeated explicit selection and caller state with sheetSelection=%s", async (sheetSelection) => {
  const { original, saved, config, volume } = setup(sheetSelection);
  const before = structuredClone(original);
  const result = await createEngine(config).convert({ ...request,
    selection: { kind: "ids", ids: ["b", "a", "b"] },
    destination: { kind: "resource", uri: "/result.csv" }
  }, { signal: new AbortController().signal });
  expect(result.artifacts.map(artifact => artifact.uri)).toEqual([
    "file:///result.csv.0", "file:///result.csv.1", "file:///result.csv.2"
  ]);
  expect(saved).toEqual(sheetSelection ? [
    { order: ["a", "b"], active: "a", selected: ["b"] },
    { order: ["a", "b"], active: "a", selected: ["a"] },
    { order: ["a", "b"], active: "a", selected: ["b"] }
  ] : [
    { order: ["b", "a"], active: "b", selected: ["b"] },
    { order: ["a", "b"], active: "a", selected: ["a"] },
    { order: ["b", "a"], active: "b", selected: ["b"] }
  ]);
  expect(volume.toJSON()).toEqual({ "/input": "original", "/result.csv.0": "b", "/result.csv.1": "a", "/result.csv.2": "b" });
  expect(original).toEqual(before);
});

it("retains repeated publication effects when an unknown escape makes all filenames collide", async () => {
  const { saved, config, volume } = setup();
  const result = await createEngine(config).convert({ ...request,
    selection: { kind: "ids", ids: ["b", "a", "b"] },
    destination: { kind: "resource", uri: "/collision-%q" }
  }, { signal: new AbortController().signal });
  expect(saved.map(save => save.selected)).toEqual([["b"], ["a"], ["b"]]);
  expect(result.artifacts).toEqual(Array.from({ length: 3 }, () => ({ uri: "file:///collision-", bytes: 1 })));
  expect(result.usage.outputBytes).toBe(3);
  expect(volume.toJSON()).toEqual({ "/input": "original", "/collision-": "b" });
});

it("does not start another sheet after cancellation following a completed publication", async () => {
  const { config, saved, volume } = setup();
  const controller = new AbortController();
  const reason = new Error("independent cancellation");
  const engine = createEngine({ ...config, filesystem: {
    read: config.filesystem.read,
    async write(uri, bytes, signal) {
      await config.filesystem.write(uri, bytes, signal);
      controller.abort(reason);
    }
  } });
  await expect(engine.convert({ ...request, destination: { kind: "resource", uri: "/cancel" } },
    { signal: controller.signal })).rejects.toBe(reason);
  expect(saved).toHaveLength(1);
  expect(volume.toJSON()).toEqual({ "/input": "original", "/cancel.0": "a" });
});

it("retains Unicode, percent, backslash and path components without silently sanitizing names", () => {
  expect(splitOutput("output/%s/%o-%n%%", { id: "a", name: "../雪 #?%\\", cells: [] }, 0,
    "/authorized", "図/leaf")).toEqual({ kind: "resource",
    uri: "file:///authorized/%E9%9B%AA%20%23%3F%25%5C/%E5%9B%B3/leaf-0%25" });
  expect(splitOutput("/%s", { id: "a", name: "%n", cells: [] }, 12, "/").uri).toBe("file:///%25n");
  expect(splitOutput("/%%%q%%%", { id: "a", name: "unused", cells: [] }, 12, "/").uri).toBe("file:///%25%25");
});

it("refuses an unauthorized URI substitution before publication", async () => {
  const { config, volume } = setup();
  config.codecs[0]!.read = async () => ({ sheets: [{ id: "a", name: "https://unapproved.example/result", cells: [] }] });
  await expect(createEngine(config).convert({ ...request, destination: { kind: "resource", uri: "%s" } },
    { signal: new AbortController().signal })).rejects.toMatchObject({ code: "capability-denied" });
  expect(volume.toJSON()).toEqual({ "/input": "original" });
});

it("attempts remaining graphs on the failed sheet but does not publish graphs on a later sheet", async () => {
  // ssconvert.c export_objects_for_sheet retains res=1 and continues its object
  // loop; do_split_save stops only after that sheet returns the failure.
  const { config, volume } = setup();
  const writes: string[] = [];
  const errors: string[] = [];
  const engine = createEngine({ ...config, filesystem: {
    read: config.filesystem.read,
    async write(uri, bytes, signal) {
      writes.push(uri);
      if (uri === "file:///graph-1.svg") throw Object.assign(new Error("Permission denied"), { code: "EACCES" });
      await config.filesystem.write(uri, bytes, signal);
    }
  }, rendering: { async *exportGraphs() {
    yield { uri: "/unused", sheet: "a", objectName: "First", bytes: new Uint8Array([1]), mediaType: "image/svg+xml" };
    yield { uri: "/unused", sheet: "a", objectName: "Second", bytes: new Uint8Array([2]), mediaType: "image/svg+xml" };
    yield { uri: "/unused", sheet: "a", objectName: "Third", bytes: new Uint8Array([3]), mediaType: "image/svg+xml" };
    yield { uri: "/unused", sheet: "b", objectName: "Later", bytes: new Uint8Array([4]), mediaType: "image/svg+xml" };
  } } });
  const result = await runCommand(["--export-graphs", "/input", "/graph-%n.svg"], engine,
    { signal: new AbortController().signal, stdout: { async write() {} },
      stderr: { async write(bytes) { errors.push(new TextDecoder().decode(bytes)); } } });
  expect(result.exitCode).toBe(1);
  expect(writes).toEqual(["file:///graph-0.svg", "file:///graph-1.svg", "file:///graph-2.svg"]);
  expect(errors).toEqual(["Failed to write file:///graph-1.svg: Permission denied\n"]);
  expect(volume.toJSON()).toEqual({ "/input": "original", "/graph-0.svg": "\u0001", "/graph-2.svg": "\u0003" });
});

it("preserves graph cancellation reason and finalizes the renderer without another write", async () => {
  const { config, volume } = setup();
  const controller = new AbortController();
  const reason = new Error("graph cancellation");
  let finalized = false;
  let yielded = 0;
  const engine = createEngine({ ...config, filesystem: {
    read: config.filesystem.read,
    async write(uri, bytes, signal) {
      await config.filesystem.write(uri, bytes, signal);
      controller.abort(reason);
    }
  }, rendering: { async *exportGraphs() {
    try {
      yielded++;
      yield { uri: "/unused", sheet: "a", bytes: new Uint8Array([1]), mediaType: "image/svg+xml" };
      yielded++;
      yield { uri: "/unused", sheet: "a", bytes: new Uint8Array([2]), mediaType: "image/svg+xml" };
    } finally { finalized = true; }
  } } });
  await expect(engine.convert({ input: request.input, graphs: true,
    destination: { kind: "resource", uri: "/graph-%n.svg" } },
  { signal: controller.signal })).rejects.toBe(reason);
  expect(finalized).toBe(true);
  expect(yielded).toBe(1);
  expect(volume.toJSON()).toEqual({ "/input": "original", "/graph-0.svg": "\u0001" });
});

it("keeps cumulative graph output budget failures fatal without publishing the over-budget object", async () => {
  const { config, volume } = setup();
  let finalized = false;
  const engine = createEngine({ ...config, limits: { ...config.limits, outputBytes: 1 },
    rendering: { async *exportGraphs() {
      try {
        yield { uri: "/unused", sheet: "a", bytes: new Uint8Array([1]), mediaType: "image/svg+xml" };
        yield { uri: "/unused", sheet: "a", bytes: new Uint8Array([2]), mediaType: "image/svg+xml" };
      } finally { finalized = true; }
    } }
  });
  await expect(engine.convert({ input: request.input, graphs: true,
    destination: { kind: "resource", uri: "/graph-%n.svg" } },
  { signal: new AbortController().signal })).rejects.toMatchObject({ code: "resource-limit" });
  expect(finalized).toBe(true);
  expect(volume.toJSON()).toEqual({ "/input": "original", "/graph-0.svg": "\u0001" });
});

it("counts every attempted graph and retains ordered multiple failures in the shared SDK result", async () => {
  const { config, volume } = setup();
  let finalized = false;
  const writes: string[] = [];
  const engine = createEngine({ ...config, limits: { ...config.limits, outputBytes: 200 }, filesystem: {
    read: config.filesystem.read,
    async write(uri, bytes, signal) {
      writes.push(uri);
      if (uri === "file:///multi-0.svg" || uri === "file:///multi-2.svg")
        throw Object.assign(new Error("No space left on device"), { code: "ENOSPC" });
      await config.filesystem.write(uri, bytes, signal);
    }
  }, rendering: { async *exportGraphs() {
    try {
      for (let index = 0; index < 4; index++)
        yield { uri: "/unused", sheet: "a", bytes: new Uint8Array([index + 1]), mediaType: "image/svg+xml" };
      yield { uri: "/unused", sheet: "b", bytes: new Uint8Array([5]), mediaType: "image/svg+xml" };
    } finally { finalized = true; }
  } } });
  const result = await engine.convert({ input: request.input, graphs: true,
    destination: { kind: "resource", uri: "/multi-%n.svg" } },
  { signal: new AbortController().signal });
  expect(result.exitCode).toBe(1);
  expect(result.artifacts).toEqual([{ uri: "file:///multi-1.svg", bytes: 1 }, { uri: "file:///multi-3.svg", bytes: 1 }]);
  expect(result.usage.outputBytes).toBe(2);
  expect(result.diagnostics.map(diagnostic => diagnostic.message)).toEqual([
    "Failed to write file:///multi-0.svg: No space left on device",
    "Failed to write file:///multi-2.svg: No space left on device"
  ]);
  expect(writes).toEqual(["file:///multi-0.svg", "file:///multi-1.svg", "file:///multi-2.svg", "file:///multi-3.svg"]);
  expect(finalized).toBe(true);
  expect(volume.toJSON()).toEqual({ "/input": "original", "/multi-1.svg": "\u0002", "/multi-3.svg": "\u0004" });
});

it("reserves failed graph publication bytes before admitting a subsequent object", async () => {
  const { config, volume } = setup();
  const writes: string[] = [];
  const engine = createEngine({ ...config, filesystem: {
    read: config.filesystem.read,
    async write(uri, bytes, signal) {
      writes.push(uri);
      if (uri === "file:///budget-0.svg") throw Object.assign(new Error("denied"), { code: "EACCES" });
      await config.filesystem.write(uri, bytes, signal);
    }
  }, rendering: { async *exportGraphs() {
    yield { uri: "/unused", sheet: "a", bytes: new Uint8Array(60), mediaType: "image/svg+xml" };
    yield { uri: "/unused", sheet: "a", bytes: new Uint8Array(60), mediaType: "image/svg+xml" };
  } } });
  await expect(engine.convert({ input: request.input, graphs: true,
    destination: { kind: "resource", uri: "/budget-%n.svg" } },
  { signal: new AbortController().signal })).rejects.toMatchObject({ code: "resource-limit" });
  expect(writes).toEqual(["file:///budget-0.svg"]);
  expect(volume.toJSON()).toEqual({ "/input": "original" });
});
