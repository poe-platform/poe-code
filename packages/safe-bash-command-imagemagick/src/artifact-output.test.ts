import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const fixture = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAANdEVYdGNvbW1lbnQAaGVsbG9VgeXRAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA4OjQ4OjAwKzAwOjAwyByfAgAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwODo0ODowMCswMDowMLlBJ74AAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMDg6NDg6MDArMDA6MDDuVAZhAAAADXRFWHRub3RlAG9yaWdpbmFspRFDOAAAABVJREFUCNdjPBEpx8DAwMDAwMQAAwAXVAFDa/2bLwAAAABJRU5ErkJggg==", "base64");

for (const mode of ["buffered", "command"] as const) {
  for (const expandLabel of [false, true]) {
    it(`keeps artifacts temporary while preserving PNG properties (${mode}, label=${expandLabel})`, async () => {
      const files = new Map<string, Uint8Array>([["/in.png", fixture], ["/out.png", Buffer.from("keep")]]);
      const fs = new MemoryFileSystem();
      for (const [path, bytes] of files) await fs.writeFile(path, bytes);
      const args = ["/in.png", "-set", "artifact:thing", "runtime-only", "-write", "/intermediate.png",
        ...(expandLabel ? ["-set", "label", "%[artifact:thing]"] : []), "/out.png"];
      const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} }
      });
      expect(result.exitCode).toBe(0);
      for (const path of ["/intermediate.png", "/out.png"]) {
        const output = Buffer.from(mode === "buffered" ? files.get(path)! : await fs.readFile(path));
        const decoded = decodeImage(output);
        expect(decoded.data).toEqual(decodeImage(fixture).data);
        expect(decoded.properties).toMatchObject({ note: "original", comment: "hello" });
        expect(decoded.properties?.label).toBe(expandLabel && path === "/out.png" ? "runtime-only" : undefined);
        const textKeys: string[] = [];
        for (let offset = 8; offset + 12 <= output.length;) {
          const length = output.readUInt32BE(offset);
          const type = output.toString("ascii", offset + 4, offset + 8);
          if (["tEXt", "zTXt", "iTXt"].includes(type)) {
            const payload = output.subarray(offset + 8, offset + 8 + length);
            textKeys.push(payload.subarray(0, payload.indexOf(0)).toString());
          }
          offset += length + 12;
        }
        expect(textKeys).toContain("note");
        expect(textKeys).toContain("comment");
        expect(textKeys).not.toContain("artifact:thing");
      }
    });
  }
}
