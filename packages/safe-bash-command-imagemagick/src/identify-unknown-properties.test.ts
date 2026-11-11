import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, createMagickCommand, runIdentifyCli, runIdentifyCliSync } from "./index.js";

it.each([
  "A%[widthB", "A%[]B", "%wA%[widthB", "%[height]A%[]B", "%[fx:u[0].w"
])("rejects malformed bracket properties without partial stdout: %s", async format => {
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tile.ppm", new Uint8Array([
    ...new TextEncoder().encode("P6\n3 2\n255\n"),
    ...[255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 0, 0, 0, 255, 0, 0, 0, 255]
  ]));
  const command = createIdentifyCommand();
  const argumentValues = createCommandArguments(["-format", format, "/tile.ppm"]);
  let stdout = "", stderr = "";
  const result = await command.execute({
    command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
    signal: new AbortController().signal, stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode).toBe(1);
  expect(stdout).toBe("");
  expect(stderr).toContain(format.includes("%[]") ? "unknown image property '%[]'" : "unbalanced braces");
});

it.each(["sync", "map", "filesystem", "stream", "identify", "magick"])("omits unknown properties and warns through %s", async route => {
  const bytes = await sharp({ create: { width: 3, height: 2, channels: 3, background: "red" } }).png().toBuffer();
  const fs = new MemoryFileSystem();
  await fs.writeFile("/photo.png", bytes);
  const files = new Map([["/photo.png", bytes]]);
  for (const { format, expected, unknown } of [
    ...["a", "j", "v", "E", "!", "?"].map(character => ({
      format: `A%${character}B`, expected: "AB", unknown: [`%${character}`]
    })),
    { format: "%a%w%?%h%j", expected: "32", unknown: ["%a", "%?", "%j"] },
    { format: "%c|%l|%u|%o|%%|%%a|\\%?|end%", expected: "||||%|%a|%?|end%", unknown: [] },
    { format: "50%a|50%?|50%%|%w", expected: "50%a|50%?|50%|3", unknown: [] },
    { format: "A%'B|A%\"B", expected: "A%'B|A%\"B", unknown: [] },
    { format: "A%[missing_demo_property]B", expected: "AB", unknown: ["%[missing_demo_property]"] },
    { format: "A%[filename]B", expected: "AB", unknown: ["%[filename]"] },
    { format: "%[width]x%[height]|%f|%[missing_demo_property]|%[filename]|%[opaque]", expected: "3x2|photo.png|||True", unknown: ["%[missing_demo_property]", "%[filename]"] },
    { format: "%%[missing_demo_property]|%[width]x%[height]", expected: "%[missing_demo_property]|3x2", unknown: [] },
    { format: "%%[width]|%%[]|%%[width", expected: "%[width]|%[]|%[width", unknown: [] }
  ]) {
    const args = ["-format", format, "/photo.png"];
    let stdout = "", stderr = "";
    const sinks = {
      stdout: { async write(bytes: Uint8Array) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    };
    let result;
    if (route === "sync") result = runIdentifyCliSync(args, files);
    else if (route === "map") result = await runIdentifyCli(args, files);
    else if (route === "filesystem") result = await runIdentifyCli(args, { filesystem: fs, cwd: "/" });
    else if (route === "stream") {
      result = await runIdentifyCli(args, { filesystem: fs, cwd: "/", ...sinks });
      expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
      result = { ...result, stdout, stderr };
    } else {
      const command = route === "magick" ? createMagickCommand() : createIdentifyCommand();
      const argumentValues = createCommandArguments(route === "magick" ? ["identify", ...args] : args);
      result = await command.execute({
        command: command.name, args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
        signal: new AbortController().signal, stdin: (async function* () {})(), ...sinks
      });
      result = { ...result, stdout, stderr };
    }
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toBe(expected);
    expect(result.stderr).toBe(unknown.map(property => `identify: unknown image property '${property}'\n`).join(""));
  }
});
