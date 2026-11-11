import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 OTB bytes and gray-output SHA-256 values.
// Generated from P4 PBM input, independently of the image-ast encoders.
const fixtures = [
  { width: 11, input: Buffer.from("000b0c01a52058e0f040a52058e0f040a52058e0f040a52058e0f040", "hex"),
    sha256: "55c314319c292a137abb00a59aeb1dfcc3a3367ac66213f2cc3635eec46ed76b" },
  { width: 259, input: Buffer.concat([Buffer.from("100103000c01", "hex"),
    Buffer.from(Array.from({ length: 33 * 12 }, (_, i) => i % 33 === 32 ? 160 : (i % 33 * 13 + Math.floor(i / 33) * 29 + 5) % 256))]),
    sha256: "3073be48303ddd682a2750abd7b5f000034daa8fdab8b2cb20c7b1cc5c2e81b8" }
];

for (const mode of ["sync", "buffered", "retained", "command"] as const) {
  for (const { width, input, sha256 } of fixtures) {
    it(`decodes native ${width}-pixel OTB rows (${mode})`, async () => {
      const files = new Map<string, Uint8Array>([["/in.otb", input]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/in.otb", input);
      const args = ["/in.otb", "-depth", "8", "gray:/out.raw"];
      if (mode === "command") {
        const arguments_ = createCommandArguments(args);
        let stderr = "";
        const result = await createMagickCommand().execute({
          command: "magick", args: arguments_.args, argumentValues: arguments_, cwd: "/", env: {}, fs: filesystem,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
      } else {
        expect(mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files))
          .toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const output = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.raw") : files.get("/out.raw")!;
      expect(output.length).toBe(width * 12);
      expect(createHash("sha256").update(output).digest("hex")).toBe(sha256);
    });
  }
}
