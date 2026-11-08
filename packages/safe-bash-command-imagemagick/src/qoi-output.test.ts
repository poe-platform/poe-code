import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const nativeFfmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

for (const alpha of [false, true]) {
for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const output of ["/out.qoi", "QOI:/out.bin"]) {
    for (const write of [false, true]) {
      it(`writes RGB/RGBA QOI (alpha=${alpha}, ${mode}, ${output}, write=${write})`, async () => {
        const data = Uint8Array.from(Buffer.from("123456ff133557ff133557ffabcdef80123456ffabcdef00808080ff000000ff", "hex"));
        if (!alpha) for (let i = 3; i < data.length; i += 4) data[i] = 255;
        const input = encodeImage({ width: 4, height: 2, data, format: "raw", space: "srgb", channels: alpha ? 4 : 3, depth: "uchar", hasAlpha: alpha, density: 72 }, { format: "png", pngCoder: alpha ? "png32" : "png24" }).data;
        const files = new Map([["/in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["/in.png", ...(write ? ["-write", output, "/final.png"] : [output])];
        let commandResult;
        if (mode === "command") {
          const arguments_ = createCommandArguments(args);
          let stderr = "";
          const result = await createMagickCommand().execute({
            command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
          });
          commandResult = { exitCode: result.exitCode, stdout: "", stderr };
        }
        const result = commandResult ?? (mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files));
        expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const path = output.startsWith("QOI:") ? output.slice(4) : output;
        const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile(path) : files.get(path)!;
        expect(Array.from(bytes.subarray(0, 14))).toEqual([113, 111, 105, 102, 0, 0, 0, 4, 0, 0, 0, 2, alpha ? 4 : 3, 0]);
        expect(Array.from(bytes.subarray(-8))).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
        if (nativeFfmpeg && mode === "command" && !write) {
          const decoded = spawnSync("ffmpeg", ["-v", "error", "-i", "pipe:0", "-pix_fmt", "rgba", "-f", "rawvideo", "pipe:1"], { input: bytes });
          expect(decoded.stderr.toString()).toBe("");
          expect(decoded.status).toBe(0);
          expect(new Uint8Array(decoded.stdout)).toEqual(data);
        }

      });
    }
  }
}

}
