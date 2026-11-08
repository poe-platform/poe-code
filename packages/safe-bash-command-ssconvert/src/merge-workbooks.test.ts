import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand, type Codec, type Workbook } from "./index.js";

function fixture(conflict = false, rendering = true, conflictName = "Clash") {
  const volume = Volume.fromJSON({ "/one": "1", "/two": "2", "/out": "keep" });
  const events: string[] = [];
  let saved: Workbook | undefined;
  const codec: Codec = {
    id: "original", description: "Original merge fixture", extensions: ["fixture"],
    async read(bytes, _context, encoding) {
      events.push(`import:${new TextDecoder().decode(bytes)}:${encoding}`);
      return { sheets: [{ id: "s", name: "Data", cells: [] }],
        ...(conflict ? { names: [{ name: conflictName, expression: "=1" }] } : {}) };
    },
    async write(book) { events.push("save"); saved = book; return new TextEncoder().encode("merged"); }
  };
  const engine = createEngine({ codecs: [codec], limits: { inputBytes: 10000, outputBytes: 10000, cells: 100, sheets: 10, operations: 100 },
    environment: { env: { PWD: "/" }, locale: "C", timezone: "UTC" },
    filesystem: {
      async read(uri) { events.push(`read:${uri}`); return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)]; },
      async write(uri, bytes) { events.push(`write:${uri}`); volume.writeFileSync(uri, bytes); }
    }, ...(rendering ? { rendering: { async *exportGraphs(book: Workbook) { events.push(`graphs:${book.sheets.length}`); yield* []; } } } : {}) });
  const diagnostics: string[] = [];
  const operation = { signal: new AbortController().signal,
    stdout: { async write() {} }, stderr: { async write(bytes: Uint8Array) { diagnostics.push(new TextDecoder().decode(bytes)); } } };
  const args = ["-M", "/out", "-I", "original", "--import-encoding=ISO-8859-1", "-T", "original", "/one", "/two"];
  return { engine, volume, events, operation, args, diagnostics, saved: () => saved };
}

describe("shared command and SDK merge lifecycle", () => {
  it("requires two SDK inputs before any I/O", async () => {
    const f = fixture();
    await expect(f.engine.merge({ inputs: [{ kind: "resource", uri: "/one" }],
      destination: { kind: "resource", uri: "/out" }, exportType: "original" }, f.operation))
      .rejects.toMatchObject({ exitCode: 1, message: "At least two merge inputs are required." });
    expect(f.events).toEqual([]);
    expect(f.volume.readFileSync("/out", "utf8")).toBe("keep");
  });

  it("loads all forced imports before unconditional adding diagnostics and ignores --set", async () => {
    const f = fixture();
    expect(await runCommand(["--set=invalid", ...f.args], f.engine, f.operation)).toMatchObject({ exitCode: 0, usage: { inputBytes: 2, outputBytes: 6 } });
    expect(f.events).toEqual(["read:/one", "import:1:ISO-8859-1", "read:/two", "import:2:ISO-8859-1", "save", "write:/out"]);
    expect(f.diagnostics.join("")).toBe("Adding sheets from file:///one\nAdding sheets from file:///two\n");
    expect(f.saved()?.sheets.map(s => s.name)).toEqual(["Data", "Data(2)"]);
    expect(f.volume.toJSON()).toEqual({ "/one": "1", "/two": "2", "/out": "merged" });
  });

  it.each(["sheet=Data", "active-sheet=Data"])("rejects %s on the empty destination before imports", async option => {
    const f = fixture();
    expect(await runCommand(["-O", option, ...f.args], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.events).toEqual([]);
    expect(f.diagnostics.join("")).toBe('ssconvert: Unknown sheet "Data"\n');
    expect(f.volume.readFileSync("/out", "utf8")).toBe("keep");
  });

  it("aborts workbook name collisions after the second adding message without publishing", async () => {
    const f = fixture(true);
    expect(await runCommand(f.args, f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.diagnostics.join("")).toBe("Adding sheets from file:///one\nAdding sheets from file:///two\nName conflict during merge: 'Clash' appears twice at workbook scope.\n");
    expect(f.events).not.toContain("save");
    expect(f.volume.readFileSync("/out", "utf8")).toBe("keep");
  });

  it("rejects explicit split before I/O but allows graph mode to imply split afterwards", async () => {
    const f = fixture();
    expect(await runCommand(["-S", ...f.args], f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.events).toEqual([]);
    expect(f.diagnostics.join("")).toBe("--export-file-per-sheet and --merge-to are incompatible\n");
    f.diagnostics.length = 0;
    expect(await runCommand(["--export-graphs", "-M", "/out", "-I", "original", "-T", "png", "/one", "/two"], f.engine, f.operation)).toMatchObject({ exitCode: 0, artifacts: [], usage: { inputBytes: 2, outputBytes: 0 } });
    expect(f.events.at(-1)).toBe("graphs:2");
    expect(f.diagnostics.join("")).toBe("Adding sheets from file:///one\nAdding sheets from file:///two\n");
    expect(f.volume.readFileSync("/out", "utf8")).toBe("keep");
  });

  it("exports zero graphs without requiring a renderer or publishing output", async () => {
    const f = fixture(false, false);
    expect(await runCommand(["--export-graphs", "-M", "/out", "-I", "original", "-T", "png", "/one", "/two"], f.engine, f.operation))
      .toMatchObject({ exitCode: 0, artifacts: [], usage: { inputBytes: 2, outputBytes: 0 } });
    expect(f.diagnostics.join("")).toBe("Adding sheets from file:///one\nAdding sheets from file:///two\n");
    expect(f.volume.readFileSync("/out", "utf8")).toBe("keep");
  });

  it("prints workbook name conflicts using the captured C locale fallback", async () => {
    const f = fixture(true, false, "Ａ");
    expect(await runCommand(f.args, f.engine, f.operation)).toEqual({ exitCode: 1 });
    expect(f.diagnostics.join("")).toBe("Adding sheets from file:///one\nAdding sheets from file:///two\nName conflict during merge: '?' appears twice at workbook scope.\n");
    expect(f.volume.readFileSync("/out", "utf8")).toBe("keep");
  });
});
