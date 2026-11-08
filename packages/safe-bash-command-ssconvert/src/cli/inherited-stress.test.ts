import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand } from "../index.js";
import { parseCommand } from "./parser.js";

describe("independent inherited option stress", () => {
  it("refuses unmeasured translated group help instead of succeeding with empty output", () => {
    for (const name of ["help-all", "help-gtk", "help-libspreadsheet"]) {
      expect(parseCommand([`--${name}`], { help: "translated main\n", version: "translated version\n" }))
        .toMatchObject({ kind: "terminal", exitCode: 1, stdout: "",
          stderr: `Unsupported ssconvert feature: --${name} (missing locale help capture; virtual runtime parity blocker)\n` });
    }
  });

  it("preserves raw GOption filename root bytes without locale conversion", () => {
    const root = new Uint8Array([47, 255]);
    const result = parseCommand(["-L", root, "--libspreadsheet-data-dir", root, "in"]);
    root[1] = 0;
    expect(result).toMatchObject({ kind: "operation", scalarBytes: {
      "lib-dir": new Uint8Array([47, 255]), "data-dir": new Uint8Array([47, 255])
    } });
    expect(parseCommand(["--data-dir", new Uint8Array([255]), "--version"]))
      .toEqual(parseCommand(["--version"]));
  });

  it("preserves inherited hook and early help ordering", () => {
    expect(parseCommand(["--gtk-module=x", "--libspreadsheet-version"]))
      .toMatchObject({ exitCode: 0, stdout: expect.stringMatching(/^gnumeric version/) });
    expect(parseCommand(["--display=x", "--gtk-module=y", "--version"]))
      .toMatchObject({ exitCode: 1, stderr: "Unsupported ssconvert feature: --gtk-module (virtual runtime parity blocker)\n" });
    expect(parseCommand(["--gtk-module=x", "--help", "--unknown"]))
      .toMatchObject({ exitCode: 0, stderr: "" });
    expect(parseCommand(["--", "--gtk-module=x", "out"]))
      .toMatchObject({ kind: "terminal", exitCode: 1, stderr: "Usage: ssconvert [OPTION...] INFILE [OUTFILE]\n" });
  });

  it("retains module callback occurrences when a later module argument is empty", () => {
    expect(parseCommand(["--gtk-module=missing", "--gtk-gtk-module=", "--version"]))
      .toMatchObject({ exitCode: 1,
        stderr: "Unsupported ssconvert feature: --gtk-module (virtual runtime parity blocker)\n" });
  });

  it("runs inherited terminal paths through the SDK without reading or changing virtual files", async () => {
    const volume = Volume.fromJSON({ "/input": "keep", "/output": "original" });
    const before = volume.toJSON();
    const accesses: string[] = [], stdout: Uint8Array[] = [], stderr: Uint8Array[] = [];
    const engine = createEngine({
      codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 8, outputBytes: 8, cells: 1, sheets: 1, operations: 1 },
      filesystem: {
        async read(uri, signal) {
          signal.throwIfAborted(); accesses.push(`read:${uri}`);
          return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)];
        },
        async write(uri, bytes, signal) {
          signal.throwIfAborted(); accesses.push(`write:${uri}`); volume.writeFileSync(uri, bytes);
        }
      }
    });
    const controller = new AbortController();
    const operation = {
      signal: controller.signal,
      stdout: { async write(bytes: Uint8Array) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(new Uint8Array(bytes)); } }
    };
    try {
      for (const argv of [["-L", "/unmounted", "--version"], ["--gtk-module=missing", "/input", "/output"], ["--help-all"]]) {
        const parsed = parseCommand(argv);
        if (parsed.kind !== "terminal") throw Error("terminal expected");
        expect(await runCommand(argv, engine, operation)).toEqual({ exitCode: parsed.exitCode });
        expect(stdout.splice(0)).toEqual(parsed.stdout ? [new TextEncoder().encode(parsed.stdout)] : []);
        expect(stderr.splice(0)).toEqual(parsed.stderr ? [new TextEncoder().encode(parsed.stderr)] : []);
        expect(accesses).toEqual([]);
        expect(volume.toJSON()).toEqual(before);
      }
      const reason = { cancelled: true };
      controller.abort(reason);
      await expect(runCommand(["--help-gtk"], engine, operation)).rejects.toBe(reason);
      expect(stdout).toEqual([]);
      expect(stderr).toEqual([]);
      expect(accesses).toEqual([]);
      expect(volume.toJSON()).toEqual(before);
    } finally { await engine.dispose(); }
  });
});
