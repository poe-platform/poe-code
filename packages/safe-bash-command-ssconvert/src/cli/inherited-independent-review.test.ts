import { describe, expect, it } from "vitest";
import { createEngine, runCommand } from "../index.js";
import { parseCommand } from "./parser.js";

const suffix = "\nRun 'ssconvert --help' to see a full list of available command line options.\n";

describe("independent inherited namespace review", () => {
  it("keeps abbreviated GTK group names attached to their full entry names", () => {
    for (const prefix of ["g", "gt"]) {
      expect(parseCommand([`--${prefix}-gtk-module=missing`, "--version"]))
        .toMatchObject({ exitCode: 1, stdout: "",
          stderr: "Unsupported ssconvert feature: --gtk-module (virtual runtime parity blocker)\n" });
      expect(parseCommand([`--${prefix}-name`])).toMatchObject({ exitCode: 1,
        stderr: `Missing argument for --name${suffix}` });
      expect(parseCommand([`--${prefix}-name=`, "in", "out"])).toMatchObject({ exitCode: 1,
        stderr: "Unsupported ssconvert feature: --name (virtual runtime parity blocker)\n" });
      expect(parseCommand([`--${prefix}-gtk-debug=all`, "--version"]))
        .toMatchObject({ exitCode: 1, stderr: `Unknown option --${prefix}-gtk-debug=all${suffix}` });
    }
  });

  it("preserves filename bytes through abbreviated inherited groups and last-wins assignment", () => {
    const raw = new Uint8Array([47, 255]);
    const parsed = parseCommand(["--l-lib-dir=/first", "--li-lib-dir", raw,
      "--l-data-dir=", "in", "out"]);
    raw.fill(0);
    expect(parsed).toMatchObject({ kind: "operation", operands: ["in", "out"],
      scalarBytes: { "lib-dir": new Uint8Array([47, 255]), "data-dir": new Uint8Array() } });
  });

  it("does not expose inherited entries in the main or short-option namespaces", () => {
    for (const argument of ["--ver", "--libspreadsheet-ver", "--gtk-dis", "--gdk-name=x", "--L=/x", "-l"]) {
      expect(parseCommand([argument, "--version"])).toMatchObject({ exitCode: 1,
        stdout: "", stderr: `Unknown option ${argument}${suffix}` });
    }
    expect(parseCommand(["-vLh", "/raw", "--bad"])).toMatchObject({ exitCode: 0, stderr: "" });
    expect(parseCommand(["-LDh", "/raw", "--version"])).toMatchObject({ exitCode: 1,
      stderr: `Error parsing option -D${suffix}` });
  });

  it("propagates byte-sink rejection without acquiring engine or host resources", async () => {
    const accesses: string[] = [];
    const engine = createEngine({ codecs: [],
      environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 1, outputBytes: 1, cells: 1, sheets: 1, operations: 1 },
      filesystem: {
        async read(uri) { accesses.push(uri); throw new Error("unexpected read"); },
        async write(uri) { accesses.push(uri); throw new Error("unexpected write"); }
      }
    });
    const reason = { sinkFailure: true };
    const channels: string[] = [];
    try {
      await expect(runCommand(["--l-version"], engine, {
        signal: new AbortController().signal,
        stdout: { async write(bytes) { channels.push(new TextDecoder().decode(bytes)); throw reason; } },
        stderr: { async write() { throw new Error("unexpected stderr"); } }
      })).rejects.toBe(reason);
      expect(channels).toEqual(["gnumeric version '1.12.61'\ndatadir := '/opt/ssconvert-reference/share/gnumeric/1.12.61'\nlibdir := '/opt/ssconvert-reference/lib/gnumeric/1.12.61'\n"]);
      expect(accesses).toEqual([]);
    } finally { await engine.dispose(); }
  });
});
