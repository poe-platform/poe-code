import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["command", "buffered", "sync"] as const)
for (const count of [1, 2, 3])
it.each([0, 1, 2, 3])(`includes both border sides in fixed montage cells via ${mode}, ${count} tiles, border %i`, async border => {
  const input = readFileSync(new URL("./fixtures/sticker.png", import.meta.url));
  const fs = new MemoryFileSystem();
  await fs.writeFile("/in.png", input);
  const files = new Map([["/in.png", input]]);
  const args = ["-geometry", "40x30+2+5", "-tile", `${count}x1`, "-border", String(border),
    "-bordercolor", "red", ...Array<string>(count).fill("/in.png"), "/out.png"];
  if (mode === "command") {
    const argumentValues = createCommandArguments(args);
    const stderr: unknown[] = [];
    const context: CommandContext = {
      command: "montage", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: { async write() {} }, stderr: { async write(chunk) { stderr.push(chunk); } }, registerCleanup() {}
    };
    expect((await createMontageCommand().execute(context)).exitCode).toBe(0);
    expect(stderr).toEqual([]);
  } else {
    const result = mode === "sync" ? runMontageCliSync(args, files) : await runMontageCli(args, files);
    expect(result).toMatchObject({ exitCode: 0, stderr: "" });
  }
  const output = decodeImage(mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!);
  // Native ImageMagick 7: each 40x30 cell includes two borders and 2x5 padding.
  expect([output.width, output.height]).toEqual([count * (44 + border * 2), 40 + border * 2]);
});
