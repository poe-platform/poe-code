import { deflateSync } from "node:zlib";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { makeChunk, PNG_SIGNATURE } from "../tests/png-chunk.js";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const text = new TextEncoder();
const cases = [
  { name: "invalid flag", header: "\x02\0fr\0Titre\0", comment: undefined },
  { name: "invalid uncompressed method", header: "\0\x01fr\0Titre\0", comment: undefined },
  { name: "invalid compressed method", header: "\x01\x01fr\0Titre\0", compressed: true, comment: undefined },
  { name: "missing translated keyword terminator", header: "\0\0fr\0Titre", value: "", comment: undefined },
  { name: "missing language terminator", header: "\0\0fr", value: "", comment: undefined },
  { name: "missing method", header: "\0", value: "", comment: undefined },
  { name: "empty language and translated keyword", header: "\0\0\0\0", comment: "hello" },
  { name: "compressed text", header: "\x01\0fr\0Titre\0", compressed: true, comment: "hello" }
];

for (const mode of ["buffered", "command"] as const) {
  it.each(cases)(`recovers within the iTXt chunk: $name (${mode})`, async ({ header, compressed, comment, value = "hello" }) => {
    const input = Buffer.concat([
      PNG_SIGNATURE,
      makeChunk("IHDR", Uint8Array.of(0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0)),
      makeChunk("iTXt", Buffer.concat([text.encode(`Comment\0${header}`), compressed ? deflateSync(text.encode(value)) : text.encode(value)])),
      makeChunk("tEXt", text.encode("Title\0Following chunk")),
      makeChunk("IDAT", deflateSync(Uint8Array.of(0, 17, 34, 51))),
      makeChunk("IEND", new Uint8Array())
    ]);
    const keep = text.encode("keep");
    const files = new Map<string, Uint8Array>([["/in.png", input], ["/out.png", keep]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/in.png", "/out.png"];
    let stderr = "";
    const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr).toBe(0);
    const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
    const decoded = decodeImage(output);
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, 255));
    expect(decoded.properties?.Comment).toBe(comment);
    expect(decoded.properties?.Title).toBe("Following chunk");
  });
}
