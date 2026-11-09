import { inflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCli, runMogrifyCli } from "./index.js";

const cases = [
  { edits: ["+set", "NoTe"], note: undefined },
  { edits: ["+set", "note"], note: undefined },
  { edits: ["-set", "NoTe", "updated"], note: "updated" },
  { edits: ["-set", "NoTe", "updated", "+set", "note"], note: undefined },
];

function textProperties(bytes: Uint8Array): Record<string, string> {
  const properties: Record<string, string> = {};
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decoder = new TextDecoder();
  for (let offset = 8; offset + 12 <= bytes.length;) {
    const length = view.getUint32(offset);
    const type = decoder.decode(bytes.subarray(offset + 4, offset + 8));
    if (type === "tEXt" || type === "zTXt" || type === "iTXt") {
      const payload = bytes.subarray(offset + 8, offset + 8 + length);
      const separator = payload.indexOf(0);
      let text = payload.subarray(separator + 1);
      if (type === "zTXt") text = inflateSync(payload.subarray(separator + 2));
      if (type === "iTXt") {
        const languageEnd = payload.indexOf(0, separator + 3);
        const translatedEnd = payload.indexOf(0, languageEnd + 1);
        text = payload.subarray(translatedEnd + 1);
        if (payload[separator + 1]) text = inflateSync(text);
      }
      properties[decoder.decode(payload.subarray(0, separator))] = decoder.decode(text);
    }
    offset += length + 12;
  }
  return properties;
}

for (const mode of ["buffered", "retained", "command", "mogrify"]) {
  for (const { edits, note } of cases) {
    it(`updates property names case-insensitively: ${edits.join(" ")} through ${mode}`, async () => {
      const fixture = spawnSync("magick", ["-size", "3x2", "xc:#c8591e", "-set", "note", "original", "-set", "comment", "hello", "png:-"]);
      expect(fixture.status).toBe(0);
      const native = spawnSync("magick", ["-", ...edits, "png:-"], { input: fixture.stdout });
      expect(native.status).toBe(0);
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.png", fixture.stdout);
      await fs.writeFile("/out.png", new TextEncoder().encode("keep"));
      const files = new Map([["/in.png", new Uint8Array(fixture.stdout)], ["/out.png", new TextEncoder().encode("keep")]]);
      const args = ["/in.png", ...edits, "/out.png"];
      if (mode === "command") {
        expect(await createMagickCommand().execute({
          command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
          stdin: (async function* () {})(), signal: new AbortController().signal,
          stdout: { write: async () => {} }, stderr: { write: async () => {} }
        })).toMatchObject({ exitCode: 0 });
      } else {
        expect(await (mode === "mogrify" ? runMogrifyCli([...edits, "/in.png"], { filesystem: fs, cwd: "/" }) : runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files)))
          .toEqual({ exitCode: 0, stdout: "", stderr: "" });
      }
      const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile(mode === "mogrify" ? "/in.png" : "/out.png");
      for (const input of [native.stdout, output]) {
        const properties = textProperties(input);
        expect(Object.entries(properties).filter(([key]) => key.toLowerCase() === "note"))
          .toEqual(note === undefined ? [] : [["NoTe", note]]);
        expect(properties.comment).toBe("hello");
        const pixels = spawnSync("magick", ["-", "-depth", "8", "rgb:-"], { input });
        expect(pixels.status).toBe(0);
        expect([...pixels.stdout]).toEqual(Array.from({ length: 6 }, () => [200, 89, 30]).flat());
      }
    });
  }
}
