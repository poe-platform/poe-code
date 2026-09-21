import { describe, expect, it } from "vitest";
import { parseCommand } from "./cli.js";

const profile = { help: "captured help\n", version: "captured version\n" };
const suffix = "\nRun 'ssconvert --help' to see a full list of available command line options.\n";

describe("Gnumeric main GOption grammar", () => {
  it("keeps graph export in normal conversion and derives splitting after the explicit conflict", () => {
    expect(parseCommand(["--export-graphs", "in", "out"])).toMatchObject({
      kind: "operation", action: "convert", flags: ["export-graphs", "export-file-per-sheet"]
    });
    expect(parseCommand(["--export-graphs", "--merge-to=out", "one", "two"])).toMatchObject({
      kind: "operation", action: "merge", flags: ["export-graphs", "export-file-per-sheet"]
    });
    expect(parseCommand(["--export-graphs", "-S", "--merge-to=out", "one", "two"])).toMatchObject({
      kind: "terminal", exitCode: 1, stderr: "--export-file-per-sheet and --merge-to are incompatible\n"
    });
  });
  it.each(["--version=1", "--version=", "-vv"]) ("accepts %s", (option) => {
    expect(parseCommand([option, "--version"], profile)).toEqual({
      kind: "terminal", exitCode: 0, stdout: profile.version, stderr: ""
    });
  });
  it("parses short clusters with a separate value, never an attached value", () => {
    expect(parseCommand(["in", "-vSI", "type", "out"])).toMatchObject({
      kind: "operation", operands: ["in", "out"], scalars: { "import-type": "type" },
      flags: ["verbose", "export-file-per-sheet"]
    });
    expect(parseCommand(["-Ifoo", "type", "--version"], profile)).toMatchObject({
      kind: "terminal", exitCode: 1, stderr: `Unknown option -Ifoo${suffix}`
    });
  });
  it("rejects two value-taking options in one cluster", () => {
    expect(parseCommand(["-IT", "type", "--version"], profile)).toMatchObject({
      kind: "terminal", exitCode: 1, stderr: `Error parsing option -T${suffix}`
    });
  });
  it.each(["", "out"]) ("checks explicit split/merge conflict for target %j", (target) => {
    expect(parseCommand(["-S", `--merge-to=${target}`, "--list-exporters"])).toMatchObject({
      kind: "terminal", exitCode: 1, stderr: "--export-file-per-sheet and --merge-to are incompatible\n"
    });
  });
  it("retains empty clipboard and range values as present", () => {
    expect(parseCommand(["--clipboard=", "--export-range=", "in", "out"])).toMatchObject({
      kind: "operation", action: "clipboard", scalars: { clipboard: "", "export-range": "" }
    });
  });
  it.each(["import-encoding", "import-type", "merge-to", "export-type", "export-options",
    "resize", "clipboard", "export-range", "set", "goal-seek", "tool-test"])
  ("requires a value for --%s", (name) => {
    expect(parseCommand([`--${name}`])).toMatchObject({
      kind: "terminal", exitCode: 1, stderr: `Missing argument for --${name}${suffix}`
    });
    expect(parseCommand([`--${name}=`, "--version"], profile)).toMatchObject({ exitCode: 0 });
    expect(parseCommand([`--${name}`, "--version"], profile)).toMatchObject({ exitCode: 1, stderr: "Usage: ssconvert [OPTION...] INFILE [OUTFILE]\n" });
  });
  it.each(["version", "verbose", "list-importers", "list-exporters", "export-file-per-sheet",
    "export-graphs", "list-image-formats", "recalc", "solve"])
  ("ignores attached boolean values for --%s", (name) => {
    expect(parseCommand([`--${name}=false`, `--${name}=`, "--version"], profile)).toMatchObject({ exitCode: 0 });
  });
  it("retains ordered arrays and last scalar values across operands", () => {
    expect(parseCommand(["--set=first", "in", "-O", "first", "--goal-seek=", "--tool-test", "one",
      "--set=second", "out", "--export-options=", "--tool-test=two", "--goal-seek=last", "-vv"])).toMatchObject({
      kind: "operation", operands: ["in", "out"], scalars: { "export-options": "" }, flags: ["verbose"],
      arrays: { set: ["first", "second"], "goal-seek": ["", "last"], "tool-test": ["one", "two"] }
    });
  });
  it.each(["--ver", "--I", "--v", "-version", "-I=foo", "--unknown", "---version"])
  ("rejects %s without aliases or abbreviations", (option) => {
    expect(parseCommand([option, "value", "--version"], profile)).toMatchObject({
      exitCode: 1, stderr: `Unknown option ${option}${suffix}`
    });
  });
  it("ends option parsing only at an unconsumed double dash", () => {
    expect(parseCommand(["--", "--version"])).toMatchObject({ kind: "operation", operands: ["--", "--version"] });
    expect(parseCommand(["-", "--", "--version"])).toMatchObject({ exitCode: 1, stderr: "Usage: ssconvert [OPTION...] INFILE [OUTFILE]\n" });
    expect(parseCommand(["-I", "--", "in", "--version"], profile)).toMatchObject({ exitCode: 0 });
  });
  it("preserves terminal and action precedence", () => {
    expect(parseCommand(["--version", "--unknown"], profile)).toMatchObject({ exitCode: 1 });
    expect(parseCommand(["-S", "--merge-to=", "--version"], profile)).toMatchObject({ exitCode: 0 });
    const actions = ["--list-exporters", "--list-importers", "--list-image-formats", "--clipboard=", "--merge-to="];
    for (let index = 0; index < actions.length; index++) {
      expect(parseCommand([...actions.slice(index).reverse(), "--export-range=", "in", "out"])).toMatchObject({
        kind: "operation", action: ["list-exporters", "list-importers", "list-image-formats", "clipboard", "merge"][index]
      });
    }
    expect(parseCommand(["--merge-to=out", "one"])).toMatchObject({ exitCode: 1 });
    expect(parseCommand(["--merge-to=out", "one", "two", "three"])).toMatchObject({ kind: "operation", action: "merge" });
    expect(parseCommand(["one"])).toMatchObject({ kind: "operation", action: "convert" });
  });
  it("help exits while parsing, with preceding errors taking priority", () => {
    expect(parseCommand(["--help", "--unknown"], profile)).toMatchObject({ exitCode: 0, stdout: profile.help });
    expect(parseCommand(["--unknown", "--help"], profile)).toMatchObject({ exitCode: 1 });
    expect(parseCommand(["-vh", "--unknown"], profile)).toMatchObject({ exitCode: 0 });
    expect(parseCommand(["-Ih", "type", "--unknown"], profile)).toMatchObject({ exitCode: 0 });
  });
  it("handles byte arguments in parse order without eagerly decoding operands", () => {
    const invalid = new Uint8Array([255]);
    expect(parseCommand([invalid, "--version"], profile)).toMatchObject({ exitCode: 0 });
    expect(parseCommand(["--import-type", invalid, "--version"], profile)).toMatchObject({
      exitCode: 1, stderr: `Invalid byte sequence in conversion input${suffix}`
    });
    const unknown = new Uint8Array([45, 45, 255]);
    const result = parseCommand([unknown, "--version"], profile);
    expect(result).toMatchObject({ exitCode: 1 });
    if (result.kind !== "terminal") throw new Error("Expected parser error");
    expect(result.stderrBytes).toEqual(new Uint8Array([
      ...new TextEncoder().encode("[Invalid UTF-8] Unknown option --\\xff"), ...new TextEncoder().encode(suffix)
    ]));
  });
  it("keeps byte operand identity and UTF-8 BOM", () => {
    const first = new Uint8Array([255]);
    const result = parseCommand([first, new Uint8Array([254])]);
    expect(result).toMatchObject({ kind: "operation", operandBytes: [new Uint8Array([255]), new Uint8Array([254])] });
    first[0] = 1;
    expect(result).toMatchObject({ operandBytes: [new Uint8Array([255]), new Uint8Array([254])] });
    expect(parseCommand([new TextEncoder().encode("\ufeffin"), "out"])).toMatchObject({ operands: ["\ufeffin", "out"] });
  });
});
