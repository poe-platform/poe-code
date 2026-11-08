import { expect, test, vi } from "vitest";
import { createMemoryFileSystem } from "@poe-code/safe-fs";
import { PdfDocument } from "@poe-code/pdf-ast";
import { createCommandArguments, type CommandContext, type CommandDefinition, type InvocationCleanup } from "safe-bash-contracts/command";
import { parseCsvRecords } from "../../packages/safe-bash-command-csvcut/src/engine.js";
import { createCsvcutCommand } from "../../packages/safe-bash-command-csvcut/src/index.js";
import { createEnvsubstCommand } from "../../packages/safe-bash-command-envsubst/src/index.js";
import { createSha512sumCommand } from "../../packages/safe-bash-command-sha512sum/src/index.js";
import { createCsvkitCommands } from "../../packages/safe-bash-command-csvkit/src/index.js";
import { createMmdcCommand } from "../../packages/safe-bash-command-mmdc/src/index.js";
import { createFfmpegCommand } from "../../packages/safe-bash-command-ffmpeg/src/index.js";
import { createHtmlqCommand } from "../../packages/safe-bash-command-htmlq/src/index.js";
import { createDiff3Command } from "../../packages/safe-bash-command-diff3/src/index.js";
import { createFoldCommand } from "../../packages/safe-bash-command-fold/src/index.js";
import { createExiftoolCommand } from "../../packages/safe-bash-command-exiftool/src/index.js";

const encoder = new TextEncoder();
const pdf = PdfDocument.create(); pdf.addPage();
const cases: [string, () => CommandDefinition, string[], string, Record<string, string | Uint8Array>][] = [
  ["envsubst", createEnvsubstCommand, [], "$NAME\n".repeat(10000), {}],
  ["sha512sum", createSha512sumCommand, ["/a", "/b", "/c"], "", { "/a": "one", "/b": "two", "/c": "three" }],
  ["csvcut", () => createCsvkitCommands().find(command => command.name === "csvcut")!, ["-c", "1,3"], "a,b,c\n" + "1,2,3\n".repeat(5000), {}],
  ["csvcut-engine", createCsvcutCommand, ["-c", "1,3"], "a,b,c\n" + "1,2,3\n".repeat(5000), {}],
  ["csv-parser", () => ({ name: "csv-parser", description: "test CSV engine", async execute(context) {
    let rows = 0;
    for await (const row of parseCsvRecords(() => context.stdin, { signal: context.signal })) {
      if (rows === 0) expect(row.cells).toHaveLength(3);
      rows++;
    }
    expect(rows).toBe(5001);
    return { exitCode: 0 };
  } }), [], "a,b,c\n" + "1,2,3\n".repeat(5000), {}],
  ["mmdc", createMmdcCommand, ["-i", "-", "-o", "-", "-e", "svg"], "flowchart TD\n" + Array.from({ length: 50 }, (_, i) => `N${i} --> N${i + 1}`).join("\n"), {}],
  ["ffmpeg", createFfmpegCommand, ["-y", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-f", "wav", "/out.wav"], "", {}],
  ["htmlq", createHtmlqCommand, ["p"], "<p>hello</p>".repeat(2000), {}],
  ["diff3", createDiff3Command, ["-m", "/a", "/b", "/c"], "", { "/a": "same\n".repeat(1000), "/b": "same\n".repeat(1000), "/c": "same\n".repeat(1000) }],
  ["fold", createFoldCommand, ["-w", "20", "/a", "/b", "/c"], "", { "/a": "a".repeat(100), "/b": "b".repeat(100), "/c": "c".repeat(100) }],
  ["exiftool", createExiftoolCommand, Array.from({ length: 10 }, (_, i) => `/doc${i}.pdf`), "", Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`/doc${i}.pdf`, pdf.save()]))]
];

for (const [name, factory, args, input, initial] of cases) for (const cancel of [false, true]) test(`${name} ${cancel ? "cancels at a turn" : "cooperates"} with frozen clocks and no setImmediate`, async () => {
  const fs = createMemoryFileSystem();
  for (const [path, value] of Object.entries(initial)) await fs.writeFile(path, typeof value === "string" ? encoder.encode(value) : value);
  const open = vi.spyOn(fs, "open");
  const carrier = createCommandArguments(args);
  const controller = new AbortController();
  let stdout = "", stderr = "", turns = 0, writesAfterAbort = 0;
  const cleanups: InvocationCleanup[] = [];
  const context: CommandContext = { command: name, args: carrier.args, argumentValues: carrier, cwd: "/", env: { NAME: "hello" },
    signal: controller.signal, stdinIsDefault: false, registerCleanup(cleanup) { cleanups.push(cleanup); },
    stdin: { async *[Symbol.asyncIterator]() { yield encoder.encode(input); } },
    stdout: { async write(bytes: Uint8Array) { if (controller.signal.aborted) writesAfterAbort++; stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } },
    fs
  };
  const timeout = globalThis.setTimeout;
  vi.stubGlobal("setImmediate", undefined);
  vi.stubGlobal("setTimeout", ((callback: (...values: unknown[]) => void, delay?: number, ...values: unknown[]) => {
    turns++;
    return timeout(() => {
      if (cancel) controller.abort(new Error("test cancellation"));
      callback(...values);
    }, delay);
  }) as typeof setTimeout);
  vi.spyOn(Date, "now").mockReturnValue(0);
  vi.spyOn(performance, "now").mockReturnValue(0);
  try {
    if (cancel) {
      await expect(async () => factory().execute(context)).rejects.toThrow("test cancellation");
      expect(writesAfterAbort).toBe(0);
      return;
    }
    const result = await factory().execute(context);
    expect(result.exitCode, stderr).toBe(0);
    expect(turns, `${name}: stdout=${stdout.slice(0, 100)}`).toBeGreaterThanOrEqual(2);
    if (name === "htmlq") {
      expect(open).toHaveBeenCalled();
      expect(stdout).toBe("<p>hello</p>\n".repeat(2000));
    }
  } finally {
    await Promise.all(cleanups.map(cleanup => cleanup()));
    vi.restoreAllMocks(); vi.unstubAllGlobals();
    if (name === "htmlq") expect(await fs.readdir("/")).toEqual([]);
  }
});
