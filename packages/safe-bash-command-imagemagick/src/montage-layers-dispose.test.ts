import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "retained", "buffered", "sync"] as const)
it.each(["dispose", "previous", "first-previous", "first-background", "translucent", "reversed", "control"] as const)(`renders disposal canvases via ${mode}: %s`, async variant => {
  const fs = new MemoryFileSystem();
  const translucent = variant === "translucent" || variant === "reversed";
  const args = ["-background", "white", "(", "-size", translucent ? "1x1" : "2x1", translucent ? "xc:rgba(255,0,0,0.5)" : "xc:red", "-repage", translucent ? "1x1+0+0" : "3x1+0+0",
    ...(variant.startsWith("first-") ? ["-set", "dispose", variant === "first-previous" ? "Previous" : "Background"] : []), ")",
    "(", "-size", "1x1", "xc:blue", "-repage", "3x1+1+0",
    ...(variant === "previous" ? ["-set", "dispose", "Previous"] : []), ")",
    ...(variant === "control" ? [] : ["-layers", "dispose"]), ...(variant === "reversed" ? ["-reverse"] : []), "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
  let bytes: Uint8Array;
  if (mode === "command") {
    const argumentValues = createCommandArguments(["montage", ...args]);
    const chunks: Uint8Array[] = [], errors: Uint8Array[] = [];
    const context: CommandContext = {
      command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write(data) { chunks.push(data.slice()); } },
      stderr: { async write(data) { errors.push(data.slice()); } }, registerCleanup() {}
    };
    const result = await createMagickCommand().execute(context);
    expect(Buffer.concat(errors).toString()).toBe("");
    expect(result.exitCode).toBe(0);
    bytes = Buffer.concat(chunks);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, new Map())
      : await runMontageCli(args, mode === "buffered" ? new Map() : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
    bytes = result.stdoutBytes!;
  }
  const red = [255, 0, 0], blue = [0, 0, 255], white = [255, 255, 255];
  expect([...bytes]).toEqual([
    ...new TextEncoder().encode(`P6\n${translucent ? 1 : variant === "control" ? 2 : 3} 2\n255\n`),
    ...(translucent ? (variant === "reversed" ? [255, 64, 64, 255, 127, 127] : [255, 127, 127, 255, 64, 64]) : variant.startsWith("first-") ? [...white, ...white, ...white, ...white, ...white, ...white]
      : [...red, ...red, ...(variant === "control" ? [] : white),
        ...(variant === "control" ? blue : [...red, ...red]), ...white])
  ]);
});
