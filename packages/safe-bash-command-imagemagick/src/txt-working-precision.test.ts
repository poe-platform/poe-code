import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick Q16-HDRI: magick 'xc:#3685c3' -depth <depth> txt:-
const cases = [
  { depth: 3, maximum: 255, pixel: "(36,146,182)  #2492B6  srgb(14.2857%,57.1429%,71.4286%)" },
  { depth: 4, maximum: 255, pixel: "(51,136,187)  #3388BB  srgb(51,136,187)" },
  { depth: 8, maximum: 255, pixel: "(54,133,195)  #3685C3  srgb(54,133,195)" },
  { depth: 10, maximum: 65535, pixel: "(13901,34209,50096)  #364D85A1C3B0  srgb(21.2121%,52.1994%,76.4418%)" },
  { depth: 16, maximum: 65535, pixel: "(13878,34181,50115)  #36368585C3C3  srgb(54,133,195)" }
];

for (const mode of ["command", "buffered", "sync"] as const) {
  it.each([
    ...cases.map(fixture => ({ ...fixture, alpha: false })),
    { depth: 3, maximum: 255, alpha: true, pixel: "(36,146,182,146)  #2492B692  srgba(14.2857%,57.1429%,71.4286%,0.571429)" },
    { depth: 10, maximum: 65535, alpha: true, pixel: "(13901,34209,50096,32928)  #364D85A1C3B080A0  srgba(21.2121%,52.1994%,76.4418%,0.502444)" }
  ])(`preserves depth $depth alpha=$alpha TXT annotation precision through ${mode}`, async ({ depth, maximum, pixel, alpha }) => {
    const expected = `# ImageMagick pixel enumeration: 1,1,0,${maximum},srgb${alpha ? "a" : ""}\n0,0: ${pixel}\n`;
    const argv = [`xc:#3685c3${alpha ? "80" : ""}`, "-depth", String(depth), "txt:-"];
    if (mode !== "command") {
      const files = new Map<string, Uint8Array>();
      const result = mode === "sync" ? runConvertCliSync(argv, files) : await runConvertCli(argv, files);
      expect(result).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
      return;
    }
    const fs = new MemoryFileSystem();
    const command = createMagickCommand(), args = createCommandArguments(argv);
    let stdout = "", stderr = "";
    const result = await command.execute({
      command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      signal: new AbortController().signal,
      stdin: (async function* () {})(),
      stdout: { async write(chunk) { stdout += new TextDecoder().decode(chunk); } },
      stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
    });
    expect({ exitCode: result.exitCode, stdout, stderr }).toEqual({ exitCode: 0, stdout: expected, stderr: "" });
  });
}
