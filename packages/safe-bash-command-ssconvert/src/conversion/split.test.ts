import { expect, it } from "vitest";
import { splitOutput } from "./split.js";
import { Volume } from "memfs";
import { createEngine, createResourceIO } from "../index.js";

it("canonicalizes a local file URI after template expansion", () => {
  expect(splitOutput("file://localhost/results/../out-%n.csv", { id: "a", name: "First", cells: [] }, 0, "/"))
    .toEqual({ kind: "resource", uri: "file:///out-0.csv" });
});

it("owns graph filenames from emitted object identity and a global zero-based index", async () => {
  const volume = Volume.fromJSON({ "/input": "original" });
  const engine = createEngine({
    codecs: [{ id: "original", description: "Original", extensions: [], probeContent: () => true,
      async read() { return { sheets: [{ id: "a", name: "雪", cells: [] }] }; } }],
    environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 10, operations: 10 },
    filesystem: createResourceIO({ cwd: "/", filesystem: {
      async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { volume.writeFileSync(path, bytes); }
    } }),
    rendering: { async *exportGraphs() {
      yield { uri: "/wrong", sheet: "a", objectName: "図 #%", bytes: new Uint8Array([1]), mediaType: "image/svg+xml" };
      yield { uri: "/wrong", sheet: "a", objectName: "Other", bytes: new Uint8Array([2]), mediaType: "image/svg+xml" };
    } }
  });
  const result = await engine.convert({ input: { kind: "resource", uri: "/input" }, graphs: true,
    destination: { kind: "resource", uri: "/%n-%s-%o.svg" } }, { signal: new AbortController().signal });
  expect(result.artifacts.map(artifact => artifact.uri)).toEqual([
    "file:///0-%E9%9B%AA-%E5%9B%B3%20%23%25.svg", "file:///1-%E9%9B%AA-Other.svg"
  ]);
  expect(volume.toJSON()).toEqual({ "/input": "original", "/0-雪-図 #%.svg": "\u0001", "/1-雪-Other.svg": "\u0002" });
});

it("stops native filename templates at the first NUL", () => {
  expect(splitOutput("/result-%n\0ignored", { id: "a", name: "First", cells: [] }, 0, "/"))
    .toEqual({ kind: "resource", uri: "file:///result-0" });
});

it.each([
  ["/result.csv", "file:///result.csv.2"],
  ["/result-%q%o%", "file:///result-"],
  ["/result-%%-%n-%s", "file:///result-%25-2-%E9%9B%AA%20%23%25"],
  ["/result/%s", "file:///result/%E9%9B%AA%20%23%25"]
])("expands native sheet template %s", (template, uri) => {
  expect(splitOutput(template, { id: "a", name: "雪 #%", cells: [] }, 2, "/"))
    .toEqual({ kind: "resource", uri });
});
