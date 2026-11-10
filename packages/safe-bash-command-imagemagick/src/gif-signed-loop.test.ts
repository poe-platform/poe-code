import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand } from "./index.js";

it.each([[-1, 65534], [-2, 65533], [65535, 65534], [65536, 65535]])(
  "writes signed GIF loop %i through command output",
  async (loop, repeats) => {
    const fs = new MemoryFileSystem();
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const args = ["xc:red", "xc:blue", "-loop", String(loop), "-write", "/mid.gif", "gif:-"];
    const result = await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async chunk => { chunks.push(chunk.slice()); } },
      stderr: { write: async chunk => { stderr += new TextDecoder().decode(chunk); } }
    });
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    for (const output of [Buffer.concat(chunks), Buffer.from(await fs.readFile("/mid.gif"))]) {
      const extension = output.indexOf("NETSCAPE2.0");
      expect(extension).toBeGreaterThan(-1);
      expect(output.readUInt16LE(extension + 13)).toBe(repeats);
      expect(decodeImage(output, { animated: true })).toMatchObject({
        pages: 2, delay: [0, 0], data: Uint8Array.of(255, 0, 0, 255, 0, 0, 255, 255)
      });
    }
  }
);
