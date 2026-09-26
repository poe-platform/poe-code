import { describe, expect, it } from "vitest";
import { Volume } from "memfs";
import { createEngine, runCommand } from "../index.js";
import { parseCommand } from "./parser.js";

const profile = { help: "reference help\n", version: "reference version\n" };

describe("independent main GOption stress cases", () => {
  it("renders unknown option diagnostics using the captured C print channel", () => {
    const suffix = "\nRun 'ssconvert --help' to see a full list of available command line options.\n";
    for (const [argument, message] of [
      [new Uint8Array([45, 45, 255]), "[Invalid UTF-8] Unknown option --\\xff"],
      [new TextEncoder().encode("--é☃"), "Unknown option --??"],
      [new Uint8Array([45, 45, 0xc3, 0xa9, 255, 1, 9, 127]), "[Invalid UTF-8] Unknown option --\\xc3\\xa9\\xff\\x01\t\\x7f"]
    ] as const) {
      const expected = message + suffix;
      expect(parseCommand([argument], profile)).toMatchObject({
        kind: "terminal", exitCode: 1, stderr: expected,
        stderrBytes: new TextEncoder().encode(expected)
      });
    }
    expect(parseCommand([new Uint8Array([45, 45, 255])], { ...profile, listingEncoding: "utf8" })).toMatchObject({
      stderrBytes: new Uint8Array([...new TextEncoder().encode("Unknown option --"), 255, ...new TextEncoder().encode(suffix)])
    });
  });
  // GLib goption.c retains the separator when a remaining argument begins '-'.
  it("retains double dash in the positional namespace before dash-leading operands", () => {
    expect(parseCommand(["--", "-in"])).toMatchObject({
      kind: "operation", operands: ["--", "-in"]
    });
    expect(parseCommand(["in", "--", "--version"], profile)).toMatchObject({
      kind: "terminal", exitCode: 1, stderr: "Usage: ssconvert [OPTION...] INFILE [OUTFILE]\n"
    });
    expect(parseCommand(["--", "in", "out"])).toMatchObject({
      kind: "operation", operands: ["in", "out"]
    });
  });

  it("keeps retained separator and invalid filename bytes distinct and owned", () => {
    const filename = new Uint8Array([45, 255]);
    const result = parseCommand(["--", filename]);
    filename[1] = 0;
    expect(result).toMatchObject({
      kind: "operation", operandBytes: [new Uint8Array([45, 45]), new Uint8Array([45, 255])]
    });
  });

  it.each(["E", "I", "M", "T", "O"])("checks cluster value and help order for -%s", (name) => {
    expect(parseCommand([`-v${name}?`, "", "--unknown"], profile)).toMatchObject({
      kind: "terminal", exitCode: 0, stdout: profile.help
    });
    expect(parseCommand([`-${name}?`], profile)).toMatchObject({
      kind: "terminal", exitCode: 1
    });
    expect(parseCommand([`-?${name}`], profile)).toMatchObject({
      kind: "terminal", exitCode: 0, stdout: profile.help
    });
  });

  it("decodes option strings in the explicit UTF-8 profile without erasing BOM", () => {
    expect(parseCommand(["--set=\ufeffA1=é", "--set=", "in"], { ...profile, argumentEncoding: "utf8" })).toMatchObject({
      kind: "operation", arrays: { set: ["\ufeffA1=é", ""] }
    });
    expect(parseCommand(["--set", new Uint8Array([0xc0, 0x80]), "--version"], { ...profile, argumentEncoding: "utf8" })).toMatchObject({
      kind: "terminal", exitCode: 1
    });
  });

  it("selects listing precedence independently of all option permutations", () => {
    // Enumerate the complete fixed five-option permutation cohort (120 cases).
    const choices = ["--list-importers", "--list-image-formats", "--clipboard=", "--merge-to=", "--list-exporters"];
    function permutations(remaining: string[]): string[][] {
      if (remaining.length === 0) return [[]];
      return remaining.flatMap((value, index) =>
        permutations(remaining.filter((_, other) => other !== index)).map((tail) => [value, ...tail]));
    }
    const cohort = permutations(choices);
    expect(cohort).toHaveLength(120);
    for (const options of cohort) {
      expect(parseCommand(["--export-graphs", ...options, "--export-range=", "--", "-operand"])).toMatchObject({
        kind: "operation", action: "list-exporters", operands: ["--", "-operand"],
        flags: expect.arrayContaining(["export-graphs", "export-file-per-sheet"])
      });
      expect(parseCommand([...options, "-S"])).toMatchObject({
        kind: "terminal", exitCode: 1, stderr: "--export-file-per-sheet and --merge-to are incompatible\n"
      });
      expect(parseCommand([...options, "-S", "--version"], profile)).toMatchObject({
        kind: "terminal", exitCode: 0, stdout: profile.version, stderr: ""
      });
    }
  });

  it("does not locale-convert ignored boolean payloads or consume following operands", () => {
    for (const option of ["verbose", "export-file-per-sheet", "recalc", "solve", "export-graphs"]) {
      const bytes = new Uint8Array([...new TextEncoder().encode(`--${option}=`), 255]);
      expect(parseCommand([bytes, "false", "out"], profile)).toMatchObject({
        kind: "operation", action: "convert", operands: ["false", "out"]
      });
      expect(parseCommand([`--${option}`, "false", "out"], profile)).toMatchObject({
        kind: "operation", action: "convert", operands: ["false", "out"]
      });
    }
    expect(parseCommand([new Uint8Array([...new TextEncoder().encode("--set="), 255]), "--version"], profile)).toMatchObject({
      kind: "terminal", exitCode: 1, stderr: "Invalid byte sequence in conversion input\nRun 'ssconvert --help' to see a full list of available command line options.\n"
    });
  });

  it("reports the first short-cluster failure before a later help or version", () => {
    const suffix = "\nRun 'ssconvert --help' to see a full list of available command line options.\n";
    expect(parseCommand(["-vITh", "value", "--version"], profile)).toMatchObject({
      kind: "terminal", exitCode: 1, stderr: `Error parsing option -T${suffix}`
    });
    expect(parseCommand(["-Iv?", "--version"], profile)).toMatchObject({
      kind: "terminal", exitCode: 0, stdout: profile.help
    });
    expect(parseCommand(["-Ix?", "value", "--version"], profile)).toMatchObject({
      kind: "terminal", exitCode: 1, stderr: `Unknown option -Ix?${suffix}`
    });
  });
});

describe("independent parser command boundary controls", () => {
  it("loads graph input before rejecting its format and preserves the memfs namespace", async () => {
    const volume = Volume.fromJSON({ "/in.fixture": "\u0001", "/out.fixture": "keep" });
    const before = volume.toJSON();
    const io: string[] = [];
    const engine = createEngine({
      codecs: [], environment: { env: {}, locale: "C", timezone: "UTC" },
      limits: { inputBytes: 8, outputBytes: 8, cells: 1, sheets: 1, operations: 1 },
      filesystem: {
        async read(uri, signal) {
          signal.throwIfAborted(); io.push(`read:${uri}`);
          return [new Uint8Array(volume.readFileSync(uri) as Uint8Array)];
        },
        async write(uri, bytes, signal) {
          signal.throwIfAborted(); io.push(`write:${uri}`); volume.writeFileSync(uri, bytes);
        }
      }
    });
    const stderr: string[] = [], stdout: Uint8Array[] = [];
    const controller = new AbortController();
    const operation = {
      signal: controller.signal,
      stdout: { async write(bytes: Uint8Array) { stdout.push(new Uint8Array(bytes)); } },
      stderr: { async write(bytes: Uint8Array) { stderr.push(new TextDecoder().decode(bytes)); } }
    };
    try {
      expect(await runCommand(["--export-graphs", "/in.fixture", "/out.fixture"], engine, operation)).toEqual({ exitCode: 1 });
      expect(stderr).toEqual(['E Unsupported file format for file "in.fixture"\n']);
      expect(io).toEqual(["read:/in.fixture"]);
      expect(stdout).toEqual([]);
      expect(volume.toJSON()).toEqual(before);
      stderr.length = 0;
      expect(await runCommand(["--export-graphs", "--list-exporters"], engine, operation)).toEqual({ exitCode: 0 });
      expect(stderr).toEqual(["ID                                | Description\n",
        "Gnumeric_Excel:excel_biff7        | MS Excel? 5.0/95\n",
        "Gnumeric_Excel:excel_biff8        | MS Excel? 97/2000/XP\n",
        "Gnumeric_Excel:excel_dsf          | MS Excel? 97/2000/XP & 5.0/95\n",
        "Gnumeric_Excel:xlsx               | ECMA 376 1st edition (2006); [MS Excel? 2007]\n",
        "Gnumeric_Excel:xlsx2              | ISO/IEC 29500:2008 & ECMA 376 2nd edition (2008); [MS Excel? 2010]\n",
        "Gnumeric_GnomeGlossary:po         | Gnome Glossary PO file format\n",
        "Gnumeric_OpenCalc:odf             | ODF 1.2 extended conformance (*.ods)\n",
        "Gnumeric_OpenCalc:openoffice      | ODF 1.2 strict conformance (*.ods)\n",
        "Gnumeric_XmlIO:sax                | Gnumeric XML (*.gnumeric)\n",
        "Gnumeric_XmlIO:sax:0              | Gnumeric XML uncompressed (*.xml)\n",
        "Gnumeric_dif:dif                  | Data Interchange Format (*.dif)\n",
        "Gnumeric_glpk:glpk                | GLPK Linear Program Solver\n",
        "Gnumeric_html:html32              | HTML 3.2 (*.html)\n",
        "Gnumeric_html:html40              | HTML 4.0 (*.html)\n",
        "Gnumeric_html:html40frag          | HTML (*.html) fragment\n",
        "Gnumeric_html:latex               | LaTeX 2e (*.tex)\n",
        "Gnumeric_html:latex_table         | LaTeX 2e (*.tex) table fragment\n",
        "Gnumeric_html:latex_table_visible | LaTeX 2e (*.tex) table fragment of visible rows\n",
        "Gnumeric_html:roff                | TROFF (*.me)\n",
        "Gnumeric_html:xhtml               | XHTML (*.html)\n",
        "Gnumeric_html:xhtml_range         | XHTML range - for export to clipboard\n",
        "Gnumeric_lpsolve:lpsolve          | LPSolve Linear Program Solver\n",
        "Gnumeric_paradox:paradox          | Paradox database (*.db)\n",
        "Gnumeric_pdf:pdf_assistant        | PDF export\n",
        "Gnumeric_stf:stf_assistant        | Text (configurable)\n",
        "Gnumeric_stf:stf_csv              | Comma separated values (CSV)\n",
        "Gnumeric_sylk:sylk                | MultiPlan (SYLK)\n"]);
      expect(io).toEqual(["read:/in.fixture"]);
      expect(volume.toJSON()).toEqual(before);
      stderr.length = 0;
      const reason = { originalCancellation: true };
      controller.abort(reason);
      await expect(runCommand(["--version"], engine, operation, profile)).rejects.toBe(reason);
      expect(stderr).toEqual([]);
      expect(stdout).toEqual([]);
      expect(io).toEqual(["read:/in.fixture"]);
      expect(volume.toJSON()).toEqual(before);
    } finally { await engine.dispose(); }
  });
});
