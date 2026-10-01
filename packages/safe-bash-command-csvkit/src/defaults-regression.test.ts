import { expect, test, vi } from "vitest";
import type { CommandContext } from "safe-bash-contracts";
import { createCsvkitCommand, type CsvkitCommandsOptions } from "./command.js";
import { portableLocale } from "./portable-locale.js";

async function invoke(name: string, input: string | Uint8Array, args: string[], files: Record<string, string> = {}, options: CsvkitCommandsOptions = {}) {
  let stdout = "", stderr = "";
  const encoder = new TextEncoder();
  const context = {
    command: name, args, cwd: "/", env: {}, signal: new AbortController().signal,
    stdin: (async function* () { yield typeof input === "string" ? encoder.encode(input) : input; })(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
    fs: { capabilities: { read: true, streamingRead: true },
      async stat() { return { type: "file" }; },
      readStream(path: string) { return (async function* () { yield encoder.encode(files[path]!); })(); }
    }
  } as unknown as CommandContext;
  const result = await createCsvkitCommand({ ...options, name }).execute(context);
  return { ...result, stdout, stderr };
}

test("portable commands normalize missing and duplicate headers", async () => {
  expect(await invoke("csvsort", "a,a\n2,1\n1,2\n", ["-c", "1"])).toEqual({ exitCode: 0, stdout: "a,a_2\n1,2\n2,1\n", stderr: "" });
  const look = await invoke("csvlook", "a,,c\n1,2,3\n", []);
  expect(look.exitCode).toBe(0);
  expect(look.stdout.split("\n")[0]!.split("|").map(cell => cell.trim())).toEqual(["", "a", "b", "c", ""]);
  expect(await invoke("csvjoin", "", ["-I", "-c", "id", "/a.csv", "/b.csv"], {
    "/a.csv": "id,val,val2\n1,x,z\n", "/b.csv": "id,val\n1,y\n"
  })).toEqual({ exitCode: 0, stdout: "id,val,val2,val2_2\n1,x,z,y\n", stderr: "" });
});

test("portable csvgrep reads a match file from the VFS", async () => {
  expect(await invoke("csvgrep", "name\nfoo\nbar\n", ["-c", "1", "-f", "/patterns"], { "/patterns": "foo\n" }))
    .toEqual({ exitCode: 0, stdout: "name\nfoo\n", stderr: "" });
});

test("C locale supports default fixed, integer and arbitrary precision formats", () => {
  expect(portableLocale.formatNumber("1.25", "C", "%f", false)).toBe("1.250000");
  for (const format of ["%d", "%i"]) expect(portableLocale.formatNumber("-2.75", "C", format, false)).toBe("-2");
  expect(portableLocale.formatNumber("1.5", "C", "%.101f", false)).toBe("1.5" + "0".repeat(100));
});

test.each(["csvsort", "csvstat", "csvjoin", "csvjson", "csvlook", "in2csv", "csvgrep", "csvcut"])("%s yields with a frozen clock", async name => {
  vi.spyOn(Date, "now").mockReturnValue(0);
  vi.spyOn(performance, "now").mockReturnValue(0);
  let ticks = 0;
  const timer = setInterval(() => ticks++, 0);
  try {
    const args = name === "csvgrep" ? ["-c", "1", "-m", "x"] : name === "in2csv" ? ["-f", "csv"] : [];
    const result = await invoke(name, "name\n" + "x\n".repeat(2500), args);
    expect(result.exitCode).toBe(0);
    expect(ticks).toBeGreaterThan(0);
  } finally { clearInterval(timer); vi.restoreAllMocks(); }
});


test("csvpy passes normalized headers to its Agate interpreter", async () => {
  let headers: readonly string[] | undefined;
  const result = await invoke("csvpy", "", ["--agate", "-I", "/table.csv"], { "/table.csv": "a,a,\n1,2,3\n" }, {
    interpreter: { modes: ["agate"], async load() { throw new Error("expected converted table"); },
      async loadConverted(input) {
        headers = (await input.table()).headers;
        return { profile: "test", async interact() { return 0; }, async close() {} };
      }
    }
  });
  expect(result.exitCode).toBe(0);
  expect(headers).toEqual(["a", "a_2", "c"]);
});

test("match files and CSV input share the configured byte budget", async () => {
  const result = await invoke("csvgrep", "name\nfoo\n", ["-c", "1", "-f", "/patterns"], { "/patterns": "foo\n" }, { limits: { maxInputBytes: 10 } });
  expect(result.exitCode).toBe(78);
  expect(result.stderr).toContain("input byte budget exceeded");
});


test.each(["csvlook", "csvstat", "csvjson", "csvsort", "csvjoin", "csvsql", "in2csv"])("%s accepts a numeric single-column CSV with portable defaults", async name => {
  const result = await invoke(name, "x\n2\n4\n", name === "in2csv" ? ["-f", "csv"] : []);
  expect(result.exitCode).toBe(0);
  expect(result.stdout.length).toBeGreaterThan(0);
  expect(result.stderr).toBe("");
});


test.each([
  ["latin1", new Uint8Array([120, 10, 233, 10]), "x\né\n"],
  ["cp1252", new Uint8Array([120, 10, 128, 10]), "x\n€\n"],
  ["ascii", new TextEncoder().encode("x\nvalue\n"), "x\nvalue\n"],
  ["utf-16", new Uint8Array([255, 254, 120, 0, 10, 0, 233, 0, 10, 0]), "x\né\n"]
] as const)("portable csvcut includes the %s codec", async (encoding, bytes, expected) => {
  const result = await invoke("csvcut", bytes, ["-e", encoding]);
  expect(result.exitCode).toBe(0);
  // csvkit uses the selected encoding for stdout too.
  expect(result.stderr).toBe("");
  expect(result.stdout.length).toBeGreaterThan(0);
  if (encoding === "ascii") expect(result.stdout).toBe(expected);
});


test.each([[[], "1,230\n"], [["-G"], "1230\n"]] as const)("csvstat preserves integer zeroes with decimal patterns (%s)", async (args, stdout) => {
  expect(await invoke("csvstat", "a\n1230\n", ["--min", "--decimal-format", "#,##0.###", ...args]))
    .toEqual({ exitCode: 0, stdout, stderr: "" });
});
