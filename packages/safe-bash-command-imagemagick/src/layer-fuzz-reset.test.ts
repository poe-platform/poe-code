import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  for (const operation of [["-layers", "RemoveDups"], ["-layers", "CompareAny"], ["-deconstruct"]]) {
    it.each([
      { settings: ["-fuzz", "5%"], collapse: true },
      { settings: ["-fuzz", "5%", "+fuzz"], collapse: false },
      { settings: ["-fuzz", "5%", "-fuzz", "0%"], collapse: false },
      { settings: ["-fuzz", "5%", "+fuzz", "-fuzz", "5%"], collapse: true },
    ])(`${mode} ${operation.join(" ")} applies $settings`, async ({ settings, collapse }) => {
      const input = encodeImage({ width: 1, height: 2, pageHeight: 1, pages: 2,
        format: "gif", space: "srgb", channels: 4, depth: "uchar", density: 72, hasAlpha: false,
        data: new Uint8Array([100, 100, 100, 255, 110, 110, 110, 255]),
        delay: [30, 50], disposal: 1 }, { format: "gif", pageHeight: 1 }).data;
      const files = new Map([["in.gif", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.gif", input);
      const args = ["in.gif", ...settings, ...operation, "out.gif"];
      const arguments_ = createCommandArguments(args);
      const result = mode === "command"
        ? await createMagickCommand().execute({
          command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {},
          signal: new AbortController().signal, fs: filesystem,
          stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} },
          registerCleanup() {},
        } as unknown as CommandContext)
        : mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(0);
      const output = decodeImage(mode === "retained" || mode === "command"
        ? await filesystem.readFile("/out.gif") : files.get("out.gif")!, { animated: true });
      expect(output.delay).toEqual(collapse ? [operation[1] === "RemoveDups" ? 80 : 30] : [30, 50]);
      expect([...output.data]).toEqual(collapse ? (operation[1] === "RemoveDups" ? [110, 110, 110, 255] : [100, 100, 100, 255])
        : [100, 100, 100, 255, 110, 110, 110, 255]);
    });
  }
}
