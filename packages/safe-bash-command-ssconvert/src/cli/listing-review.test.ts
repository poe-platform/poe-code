import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Engine } from "../index.js";
import { exportOptionPairs } from "./export-options.js";

function fixture() {
  const volume = Volume.fromJSON({ "/source.edge": "seed" });
  const stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
  const controller = new AbortController();
  const engine = createEngine({
    codecs: [{ id: "edge", description: "Independent bytes", extensions: ["edge"],
      probeContent: () => true,
      async read() { return { sheets: [{ id: "edge", name: "First", cells: [] }] }; },
      async write() { return new Uint8Array([0, 255, 13, 10]); }
    }],
    limits: { inputBytes: 20, outputBytes: 100, cells: 10, sheets: 2, operations: 10 },
    environment: { env: {}, locale: "C", timezone: "UTC" },
    filesystem: {
      async read(uri) { return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { volume.writeFileSync(uri, bytes); }
    }
  });
  const operation = { signal: controller.signal,
    stdout: { async write(bytes: Uint8Array) { stdout.push(new Uint8Array(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr.push(new Uint8Array(bytes)); } }
  };
  return { volume, stdout, stderr, controller, engine, operation,
    errors: () => stderr.map(bytes => new TextDecoder().decode(bytes)).join("") };
}

describe("independent listing and diagnostic review", () => {
  it.each(["\t", "\n", "\r", "\f", " ", "\u00a0", "\u1680", "\u2007", "\u2028", "\u2029", "\u202f", "\u205f", "\u3000"])(
    "accepts GLib separator %j around and between pairs", separator => {
      expect([...exportOptionPairs(`${separator}sheet${separator}=${separator}First${separator}active-sheet=1${separator}`)])
        .toEqual([["sheet", "First"], ["active-sheet", "1"]]);
    }
  );
  it.each(["\u000b", "\u0085", "\u180e", "\u200b", "\ufeff"])(
    "preserves GLib nonspace %j in unquoted values", character => {
      expect([...exportOptionPairs(`sheet=First${character}`)]).toEqual([["sheet", `First${character}`]]);
      expect(() => [...exportOptionPairs(`${character}sheet=First`)]).toThrow("ssconvert: Syntax error");
    }
  );
  it.each(["é", "中", "٣", "²", "Ⅷ", "\u{10400}", "\u{10400}a7", "\u{1e5d0}"])("parses native Unicode alphanumeric key %s", key => {
    expect([...exportOptionPairs(`${key}=1`)]).toEqual([[key, "1"]]);
  });
  it.each(["\u0301", "\u{1f600}", "\ud800", "\u{10ffff}", "\u{1e6c0}"])("rejects non-alphanumeric option key %j", key => {
    expect(() => [...exportOptionPairs(`${key}=1`)]).toThrow("ssconvert: Syntax error");
  });
  it.each(["é", "\u{10400}", "²", "Ⅷ"])("matches CLI and SDK wording for Unicode unknown option %s", async key => {
    const f = fixture();
    const expected = `ssconvert: Invalid export option "${key}" for format edge`;
    await expect(f.engine.convert({ input: { kind: "resource", uri: "/source.edge" },
      destination: { kind: "stream", sink: f.operation.stdout }, exportType: "edge", exportOptions: [`${key}=1`] }, f.operation))
      .rejects.toMatchObject({ exitCode: 1, message: expected });
    expect(await runCommand(["-T", "edge", "-O", `${key}=1`, "/source.edge", "fd://1"], f.engine, f.operation,
      { listingEncoding: "utf8", argumentEncoding: "utf8" })).toEqual({ exitCode: 1 });
    expect(f.errors()).toBe(`${expected}\n`);
    expect(f.stdout).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/source.edge": "seed" });
  });
  it("cancels after the listing header without later row or namespace effects", async () => {
    const f = fixture();
    const reason = new Error("header cancellation");
    const operation = { ...f.operation, stderr: { async write(bytes: Uint8Array) {
      f.stderr.push(new Uint8Array(bytes));
      f.controller.abort(reason);
    } } };
    await expect(runCommand(["--list-exporters"], f.engine, operation)).rejects.toBe(reason);
    expect(f.errors()).toBe("ID                                | Description\n");
    expect(f.stdout).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/source.edge": "seed" });
  });
  it("selects importer descriptors only and excludes hidden width influences", async () => {
    const f = fixture();
    const observed: string[] = [];
    const engine: Engine = { ...f.engine, listServices(direction) {
      observed.push(direction);
      return [
        { id: "hidden-with-wide-name", description: "hidden", extensions: [], interactiveOnly: true },
        { id: "Z", description: "upper", extensions: [] },
        { id: "a", description: "lower", extensions: [] }
      ];
    } };
    expect(await runCommand(["--list-importers"], engine, f.operation)).toEqual({ exitCode: 0 });
    expect(observed).toEqual(["read"]);
    expect(f.errors()).toBe("ID | Description\nZ | upper\na | lower\n");
    expect(f.stdout).toEqual([]);
  });
  it("uses enum image ordering without querying installed codecs", async () => {
    const f = fixture();
    const engine: Engine = { ...f.engine, listServices() { throw new Error("image listing queried codecs"); } };
    expect(await runCommand(["--list-image-formats"], engine, f.operation)).toEqual({ exitCode: 0 });
    expect(f.errors().split("\n").slice(1, -1).map(line => line.split(" ")[0]))
      .toEqual(["svg", "png", "jpeg", "pdf", "ps", "emf", "wmf", "eps"]);
    expect(f.stdout).toEqual([]);
  });
  it.each([undefined, null, false, 0, ""])("preserves falsey stderr failure %j without retry", async reason => {
    const f = fixture();
    let calls = 0;
    const operation = { ...f.operation, stderr: { async write() { calls++; throw reason; } } };
    await expect(runCommand(["--list-importers"], f.engine, operation)).rejects.toBe(reason);
    expect(calls).toBe(1);
    expect(f.stdout).toEqual([]);
  });
  it.each(["sdk", "cli"])("preserves independent binary sink failure for %s", async route => {
    const f = fixture();
    const reason = new Error("independent destination refusal");
    const sink = { async write(bytes: Uint8Array) {
      expect(bytes).toEqual(new Uint8Array([0, 255, 13, 10]));
      throw reason;
    } };
    const invocation = route === "sdk"
      ? f.engine.convert({ input: { kind: "resource", uri: "/source.edge" },
        destination: { kind: "stream", sink }, exportType: "edge" }, f.operation)
      : runCommand(["-T", "edge", "/source.edge", "fd://1"], f.engine, { ...f.operation, stdout: sink });
    await expect(invocation).rejects.toBe(reason);
    expect(f.stderr).toEqual([]);
    expect(f.volume.toJSON()).toEqual({ "/source.edge": "seed" });
  });
});
