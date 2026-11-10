import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

for (const mode of ["magick", "montage", "retained", "buffered", "sync"] as const)
it.each(["banana", "two", "", "0", "0x0"])(`${mode}: validates montage border %j before writing output`, async border => {
  for (const output of ["ppm:-", "sheet.ppm", "existing.ppm"]) {
    const fs = new MemoryFileSystem();
    const original = new TextEncoder().encode("preserve this destination");
    await fs.writeFile("/existing.ppm", original);
    const files = new Map([["existing.ppm", original]]);
    const args = ["-geometry", "1x1+0+0", "-tile", "1x1", "-bordercolor", "black",
      "-border", border, "xc:red", output];
    let bytes: Uint8Array | undefined, stderr = "", stdout = "", exitCode: number;
    if (mode === "magick" || mode === "montage") {
      const command = mode === "magick" ? createMagickCommand() : createMontageCommand();
      const argumentValues = createCommandArguments(mode === "magick" ? ["montage", ...args] : args);
      const chunks: Uint8Array[] = [];
      const context: CommandContext = {
        command: command.name, args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write(chunk) { chunks.push(new Uint8Array(chunk)); } },
        stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }, registerCleanup() {}
      };
      exitCode = (await command.execute(context)).exitCode;
      bytes = new Uint8Array(chunks.flatMap(chunk => Array.from(chunk)));
    } else {
      const result = mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
      ({ exitCode, stderr, stdout, stdoutBytes: bytes } = result);
    }
    if (border !== "0" && border !== "0x0") {
      expect(exitCode).toBe(1);
      expect(stderr).toContain("invalid argument for option '-border'");
      expect(stderr).toContain(border);
      expect(stdout).toBe("");
      expect(bytes?.length ?? 0).toBe(0);
      expect([...files]).toEqual([["existing.ppm", original]]);
      expect(await fs.readdir("/")).toEqual([{ name: "existing.ppm", type: "file" }]);
      expect(await fs.readFile("/existing.ppm")).toEqual(original);
    } else {
      expect({ exitCode, stderr }).toEqual({ exitCode: 0, stderr: "" });
      const image = decodeImage(output === "ppm:-" ? bytes! : mode === "buffered" || mode === "sync"
        ? files.get(output)! : await fs.readFile(`/${output}`));
      expect([image.width, image.height]).toEqual([1, 1]);
      expect(Array.from(image.data)).toEqual([255, 0, 0, 255]);
    }
  }
});
