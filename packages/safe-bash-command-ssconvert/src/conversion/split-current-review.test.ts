import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, createResourceIO, runCommand, type Workbook } from "../index.js";
import { splitOutput } from "./split.js";

function fixture() {
  const volume = Volume.fromJSON({ "/input": "review" });
  const workbook: Workbook = { sheets: [
    { id: "first", name: "100% /雪", cells: [] },
    { id: "second", name: "Second", cells: [] }
  ] };
  const writes: string[] = [];
  const filesystem = createResourceIO({ cwd: "/", filesystem: {
    async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
    async write(path, bytes) { writes.push(path); volume.writeFileSync(path, bytes); }
  } });
  const engine = createEngine({
    codecs: [{ id: "review", description: "Independent URI review", extensions: ["csv"], saveScope: "sheet",
      probeContent: () => true, async read() { return workbook; },
      async write(book) { return new TextEncoder().encode(book.sheets[0]!.id); }
    }],
    filesystem, environment: { env: {}, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 1000, cells: 10, sheets: 10, operations: 100 }
  });
  return { engine, filesystem, volume, writes, workbook };
}

it.each(["file://user@localhost/result-%n", "file://localhost:42/result-%n",
  "file:///result-%%2F-%n", "file:///result-%%00-%n", "file:///result-%%ZZ-%n"])(
  "does not erase refused file authority during expansion: %s", async template => {
    const { engine, filesystem, volume, writes } = fixture();
    const signal = new AbortController().signal;
    // Negative control: the injected public I/O rejects the same unexpanded URI.
    await expect(filesystem.write(template.replace("%n", "0").replaceAll("%%", "%"), new Uint8Array([1]), signal))
      .rejects.toMatchObject({ code: "io" });
    await expect(engine.convert({ input: { kind: "resource", uri: "/input" },
      destination: { kind: "resource", uri: template }, exportType: "review", perSheet: true }, { signal }))
      .rejects.toMatchObject({ code: "io" });
    expect(writes).toEqual([]);
    expect(volume.toJSON()).toEqual({ "/input": "review" });
  }
);

it("preserves escaped URI percent names without treating them as template escapes twice", async () => {
  const { engine, volume, workbook } = fixture();
  const before = structuredClone(workbook);
  const result = await engine.convert({ input: { kind: "resource", uri: "/input" },
    destination: { kind: "resource", uri: "file://localhost/a%%20b-%%25-%n.csv" },
    exportType: "review", perSheet: true }, { signal: new AbortController().signal });
  expect(result.artifacts.map(artifact => artifact.uri)).toEqual([
    "file:///a%20b-%25-0.csv", "file:///a%20b-%25-1.csv"
  ]);
  expect(volume.toJSON()).toEqual({ "/input": "review", "/a b-%-0.csv": "first", "/a b-%-1.csv": "second" });
  expect(workbook).toEqual(before);
});

it("uses the shared CLI engine and keeps earlier files when the next save fails", async () => {
  const { engine, volume } = fixture();
  volume.mkdirSync("/result.csv.1");
  const stderr: string[] = [];
  const stdout: string[] = [];
  const result = await runCommand(["-S", "-T", "review", "/input", "/result.csv"], engine,
    { signal: new AbortController().signal,
      stdout: { async write(bytes) { stdout.push(new TextDecoder().decode(bytes)); } },
      stderr: { async write(bytes) { stderr.push(new TextDecoder().decode(bytes)); } } });
  expect(result.exitCode).toBe(1);
  expect(stdout).toEqual([]);
  expect(stderr.join("")).toContain("result.csv.1");
  expect(volume.readFileSync("/result.csv.0", "utf8")).toBe("first");
  expect(volume.statSync("/result.csv.1").isDirectory()).toBe(true);
  expect(volume.existsSync("/result.csv.2")).toBe(false);
});

it.each([
  ["a.csv", "file:///review/a.csv.0"],
  ["a.csv%", "file:///review/a.csv"],
  ["%o", "file:///review"],
  ["%s", "file:///review/100%25%20/%E9%9B%AA"],
  ["a%%2F-%n", "file:///review/a%252F-0"]
])("keeps source template syntax distinct from URI escaping for %s", (template, uri) => {
  expect(splitOutput(template, { id: "first", name: "100% /雪", cells: [] }, 0, "/review").uri).toBe(uri);
});
