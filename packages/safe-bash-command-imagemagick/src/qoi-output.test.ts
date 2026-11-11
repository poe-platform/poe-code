import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
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

it.each([
  { width: 62, color: "black", pixel: [0, 0, 0, 255], payload: "fd" },
  { width: 63, color: "black", pixel: [0, 0, 0, 255], payload: "fdc0" },
  { width: 128, color: "black", pixel: [0, 0, 0, 255], payload: "fdfdc3" },
  { width: 1, color: "#010101", pixel: [1, 1, 1, 255], payload: "7f" },
  { width: 1, color: "#030503", pixel: [3, 5, 3, 255], payload: "a566" },
  { width: 1, color: "#804020", pixel: [128, 64, 32, 255], payload: "fe804020" },
])("writes compact QOI for $width pixels of $color", async ({ width, color, pixel, payload }) => {
  const chunks: Uint8Array[] = [];
  let stderr = "";
  const result = await createMagickCommand().execute({
    command: "magick", args: createCommandArguments(["-size", `${width}x1`, `xc:${color}`, "qoi:-"]).args,
    fs: new MemoryFileSystem(), cwd: "/", env: {},
    stdin: (async function* () {})(), signal: new AbortController().signal,
    stdout: { write: async bytes => { chunks.push(bytes.slice()); } },
    stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
  });
  expect(result.exitCode, stderr).toBe(0);
  const output = Buffer.concat(chunks);
  expect(output.subarray(14, -8).toString("hex")).toBe(payload);
  expect(output.length).toBe(22 + payload.length / 2);
  expect(decodeImage(output).data).toEqual(Uint8Array.from(Array.from({ length: width }, () => pixel).flat()));
});
