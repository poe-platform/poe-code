import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeImage, decodeImage } from "@poe-code/image-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick: magick -size 4x4 xc:red xc:blue +append -depth 8 in.sun
const rgb = Buffer.from(("ff0000".repeat(4) + "0000ff".repeat(4)).repeat(4), "hex");
const input = Buffer.concat([Buffer.from("59a66a9500000008000000040000001800000060000000030000000000000000", "hex"), rgb]);

const png = encodeImage(decodeImage(rgb, { raw: { width: 8, height: 4, channels: 3 } }), { format: "png" }).data;

for (const spelling of ["in.sun", "sun:in.sun", "in.png", "png:in.png"]) {
  const format = spelling.endsWith("png") ? "png" : "sun";
  const bytes = format === "png" ? png : input;
  for (const mode of ["sync", "buffered", "retained", "command"] as const) {
    it(`reads ${spelling} with native RGB samples (${mode})`, async () => {
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile(`/in.${format}`, bytes);
      const files = new Map<string, Uint8Array>([[`in.${format}`, bytes]]);
      const args = [spelling, "-depth", "8", "rgb:/out"];
      if (mode === "command") {
        const arguments_ = createCommandArguments([spelling, "-format", "%n|%w|%h", "-write", "info:/metadata", "-depth", "8", "rgb:-"]);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result = await createMagickCommand().execute({
          command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr }).toEqual({ exitCode: 0, stderr: "" });
        expect(Buffer.concat(chunks)).toEqual(rgb);
        expect(new TextDecoder().decode(await filesystem.readFile("/metadata"))).toBe("1|8|4");
      } else {
        const result = mode === "sync" ? runConvertCliSync(args, files)
          : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        expect(Buffer.from(mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!)).toEqual(rgb);
      }
      expect(await runConvertCli([spelling, "-format", "%n|%w|%h\\n", "info:"], { filesystem, cwd: "/" }))
        .toEqual({ exitCode: 0, stdout: "1|8|4\n", stderr: "" });
    });
  }
}
