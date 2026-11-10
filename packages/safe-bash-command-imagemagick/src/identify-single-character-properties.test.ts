import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createIdentifyCommand, runIdentifyCli, runIdentifyCliSync, runMagickCliSync } from "./index.js";

it.each(["sync", "map", "filesystem", "command"])("resolves bracketed single-character properties case-sensitively via %s", async route => {
  const files = new Map<string, Uint8Array>();
  expect(runMagickCliSync(["-size", "3x2", "xc:red", "-page", "12x10+3+4", "/tag.png"], files).exitCode).toBe(0);
  const fs = new MemoryFileSystem();
  await fs.writeFile("/tag.png", files.get("/tag.png")!);
  const format = "%[w]|%[W]|%[h]|%[H]|%[q]|%[Q]|%[f]|%[t]|%[i]|%[height]|%[HEIGHT]|%%[h]";
  const args = ["-format", format, "/tag.png"];
  let result;
  if (route === "sync") result = runIdentifyCliSync(args, files);
  else if (route === "map") result = await runIdentifyCli(args, files);
  else if (route === "filesystem") result = await runIdentifyCli(args, { filesystem: fs, cwd: "/" });
  else {
    const argumentValues = createCommandArguments(args);
    let stdout = "", stderr = "";
    const status = await createIdentifyCommand().execute({
      command: "identify", args: argumentValues.args, argumentValues, fs, cwd: "/", env: {},
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
      stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    result = { ...status, stdout, stderr };
  }
  expect(result).toEqual({ exitCode: 0, stdout: "3|12|2|10|16|92|tag.png|tag|/tag.png|2|2|%[h]", stderr: "" });
});

it("keeps bracketed metadata case-sensitive after resizing for INFO output", () => {
  const files = new Map<string, Uint8Array>();
  expect(runMagickCliSync(["-size", "3x2", "xc:red", "-page", "12x10+3+4", "/tag.png"], files).exitCode).toBe(0);
  const result = runMagickCliSync([
    "/tag.png", "-resize", "6x4!", "-quality", "73",
    "-format", "%[w]|%[W]|%[h]|%[H]|%[q]|%[Q]|%[height]|%%[h]", "info:"
  ], files);
  expect(result).toEqual({ exitCode: 0, stdout: "6|24|4|20|16|73|2|%[h]", stderr: "" });
});
