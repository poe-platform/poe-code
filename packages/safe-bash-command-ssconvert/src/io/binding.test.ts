import { expect, it } from "vitest";
import { Volume } from "memfs";
import { createResourceIO } from "./index.js";
import { createEngine, type Codec, type Environment } from "../index.js";

it("uses the resource binding cwd for engine identities without changing GETENV PWD", async () => {
  const volume = Volume.fromJSON({ "/actual/input.fixture": "original" });
  const observed: { filename?: string; environment: Environment }[] = [];
  const codec: Codec = {
    id: "fixture", description: "Original resource identity fixture", extensions: ["fixture"],
    probeContent: () => true,
    async read(_bytes, context) {
      observed.push({ ...(context.inputFilename === undefined ? {} : { filename: context.inputFilename }),
        environment: context.environment });
      return { sheets: [{ id: "s1", name: "Sheet1", cells: [] }] };
    },
    async write() { return new TextEncoder().encode("converted"); }
  };
  const engine = createEngine({
    codecs: [codec],
    environment: { env: { PWD: "/foreign" }, locale: "C", timezone: "UTC" },
    limits: { inputBytes: 100, outputBytes: 100, cells: 10, sheets: 2, operations: 10 },
    filesystem: createResourceIO({ cwd: "/actual", filesystem: {
      async read(path) { return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path, bytes) { volume.writeFileSync(path, bytes); }
    } })
  });
  try {
    const result = await engine.convert({ input: { kind: "resource", uri: "input.fixture" },
      destination: { kind: "resource", uri: "output.fixture" } }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0);
    expect(observed[0]!.filename).toBe("input.fixture");
    expect(observed[0]!.environment).toMatchObject({ cwd: "/actual" });
    expect(observed[0]!.environment.env.PWD).toBe("/foreign");
    expect(volume.readFileSync("/actual/output.fixture", "utf8")).toBe("converted");
    expect(volume.existsSync("/foreign/output.fixture")).toBe(false);
    await expect(engine.convert({ input: { kind: "resource", uri: "missing.fixture" },
      destination: { kind: "resource", uri: "output.fixture" } }, { signal: new AbortController().signal }))
      .rejects.toThrow("/actual/missing.fixture");
    expect(volume.readFileSync("/actual/output.fixture", "utf8")).toBe("converted");
  } finally { await engine.dispose(); }
});

it("retains the admitted VFS namespace when the host mutates its configuration", async () => {
  const volume = Volume.fromJSON({ "/admitted/input": "original", "/foreign/input": "foreign" });
  const events: string[] = [];
  const options = {
    cwd: "/admitted",
    filesystem: {
      async read(path: string) { events.push(path); return [new Uint8Array(volume.readFileSync(path) as Uint8Array)]; },
      async write(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); }
    }
  };
  const io = createResourceIO(options);
  options.cwd = "/foreign";
  options.filesystem = {
    async read() { throw new Error("foreign capability invoked"); },
    async write() { throw new Error("foreign capability invoked"); }
  };
  const signal = new AbortController().signal;
  const bytes: number[] = [];
  for await (const chunk of await io.read("input", signal)) bytes.push(...chunk);
  expect(new TextDecoder().decode(new Uint8Array(bytes))).toBe("original");
  await io.write("output", new Uint8Array([0, 255]), signal);
  expect(events).toEqual(["/admitted/input"]);
  expect(volume.readFileSync("/admitted/output")).toEqual(Buffer.from([0, 255]));
  expect(volume.existsSync("/foreign/output")).toBe(false);
});
