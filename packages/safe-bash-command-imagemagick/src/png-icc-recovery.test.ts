import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { deflateSync } from "node:zlib";
import { makeChunk } from "../tests/png-chunk.js";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { createMagickCommand, runConvertCliSync } from "./index.js";

// One RGB pixel (112233), valid chunk CRCs, and a genuine sRGB control profile.
const fixtures = [
  { name: "iccBadZip", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADGlDQ1Bwcm9mAABicm9rZW45rfyRAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC" },
  { name: "iccwrongmethod", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAABbmlDQ1Bwcm9mAAJ4nHWRvUtCURjGf1phpOFQQ0SDQ0WDQiREbWWDi4SYQVaLXq8aqF3uVUJag5YGoSFq6WvoP6g1aC0IgiKIaG7sawm5vUcFJeoczn1/PPc8L+99Ljgjea1gdc5AoVgyY+GQbymx7HO94sYle5pgUrOM2Wg0wr/r6x6HqncB1ev/e38ud1q3NHB0C09qhlkSlmmIbJQMxTvC/VoumRY+EvabMqDwtdJTDX5RnG3wh2IzHpsDp+rpy7Zxqo21nFkQHhMeLuTLWnMe9SUevbi4IHVQzhAWMcKE8JGizBp5SgSkFiWzv33jdd886+LR5GlQwRRHlpx4/aKWpasuNSO6LjtPReX+O08rE5xodPeEoOvZtt9HwLULtaptfx/bdu0EOp7gstjyr0tOU5+iV1va8CF4t+D8qqWl9uBiGwYejaSZrEsdcpyZDLydQW8C+m6hZ6WRVfM9pw8Q35RfdAP7BzAq972rP1o3aDMcEFa1AAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC" },
  { name: "iccvalid", base64: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAABbmlDQ1Bwcm9mAAB4nHWRvUtCURjGf1phpOFQQ0SDQ0WDQiREbWWDi4SYQVaLXq8aqF3uVUJag5YGoSFq6WvoP6g1aC0IgiKIaG7sawm5vUcFJeoczn1/PPc8L+99Ljgjea1gdc5AoVgyY+GQbymx7HO94sYle5pgUrOM2Wg0wr/r6x6HqncB1ev/e38ud1q3NHB0C09qhlkSlmmIbJQMxTvC/VoumRY+EvabMqDwtdJTDX5RnG3wh2IzHpsDp+rpy7Zxqo21nFkQHhMeLuTLWnMe9SUevbi4IHVQzhAWMcKE8JGizBp5SgSkFiWzv33jdd886+LR5GlQwRRHlpx4/aKWpasuNSO6LjtPReX+O08rE5xodPeEoOvZtt9HwLULtaptfx/bdu0EOp7gstjyr0tOU5+iV1va8CF4t+D8qqWl9uBiGwYejaSZrEsdcpyZDLydQW8C+m6hZ6WRVfM9pw8Q35RfdAP7BzAq972rP1o3aDPL8cLqAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC" }
];

for (const mode of ["buffered", "command"] as const) {
  it.each(fixtures)(`recovers unreadable PNG ICC profiles: $name (${mode})`, async ({ name, base64 }) => {
    const input = Buffer.from(base64, "base64");
    const files = new Map([["/in.png", input], ["/out.png", Buffer.from("keep")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/in.png", "/out.png"];
    let stderr = "";
    const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { write: async () => {} }, stderr: { write: async bytes => { stderr += new TextDecoder().decode(bytes); } }
    });
    const warning = "stderr" in result && typeof result.stderr === "string" ? result.stderr : stderr;
    expect(result.exitCode, warning).toBe(0);
    const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
    const decoded = decodeImage(output);
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, 255));
    expect(decoded.icc).toEqual(name === "iccvalid" ? decodeImage(input).icc : undefined);
    expect(Buffer.from(output).includes(Buffer.from("iCCP"))).toBe(name === "iccvalid");
    if (name === "iccvalid") expect(warning).toBe("");
    else expect(warning).toContain("iCCP");
  });
}

it("keeps the ICC decompression limit fatal and preserves the destination", () => {
  const input = Buffer.from(fixtures[2]!.base64, "base64");
  const compressed = deflateSync(new Uint8Array(16 * 1024 * 1024 + 1));
  const chunk = makeChunk("iCCP", Buffer.concat([Buffer.from([73, 67, 67, 0, 0]), compressed]));
  const originalLength = input.readUInt32BE(33) + 12;
  const oversized = Buffer.concat([input.subarray(0, 33), chunk, input.subarray(33 + originalLength)]);
  const files = new Map([["/in.png", oversized], ["/out.png", Buffer.from("keep")]]);
  const result = runConvertCliSync(["/in.png", "/out.png"], files);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("ICC profile exceeds 16 MiB");
  expect(files.get("/out.png")).toEqual(Buffer.from("keep"));
});
