import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "command"]) {
  for (const operation of [["-layers", "RemoveDups"], ["-layers", "CompareAny"], ["-deconstruct"]]) {
    it.each([undefined, "0%", "10%", "6553.5"])(`${mode} ${operation.join(" ")} respects fuzz %s`, async fuzz => {
      const input = encodeImage({ width: 1, height: 3, pageHeight: 1, pages: 3,
        data: new Uint8Array([100, 100, 100, 255, 110, 110, 110, 255, 120, 120, 120, 255]),
        delay: [30, 50, 70], disposal: 1 }, { format: "gif", pageHeight: 1 }).data;
      const files = new Map([["in.gif", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.gif", input);
      const args = ["in.gif", ...(fuzz === undefined ? [] : ["-fuzz", fuzz]), ...operation, "out.gif"];
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
      const collapse = fuzz === "10%" || fuzz === "6553.5";
      expect(output.delay).toEqual(collapse ? [operation[1] === "RemoveDups" ? 150 : 30] : [30, 50, 70]);
      expect([...output.data]).toEqual(collapse ? [100, 100, 100, 255]
        : [100, 100, 100, 255, 110, 110, 110, 255, 120, 120, 120, 255]);
    });
  }
}
