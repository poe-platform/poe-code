import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { decodeImage } from "@poe-code/image-ast/portable";
import { transformBytes } from "@poe-code/compression";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts";
import { makeChunk } from "../tests/png-chunk.js";
import { createMagickCommand, runConvertCliSync } from "./index.js";

const control = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAABbmlDQ1Bwcm9mAAB4nHWRvUtCURjGf1phpOFQQ0SDQ0WDQiREbWWDi4SYQVaLXq8aqF3uVUJag5YGoSFq6WvoP6g1aC0IgiKIaG7sawm5vUcFJeoczn1/PPc8L+99Ljgjea1gdc5AoVgyY+GQbymx7HO94sYle5pgUrOM2Wg0wr/r6x6HqncB1ev/e38ud1q3NHB0C09qhlkSlmmIbJQMxTvC/VoumRY+EvabMqDwtdJTDX5RnG3wh2IzHpsDp+rpy7Zxqo21nFkQHhMeLuTLWnMe9SUevbi4IHVQzhAWMcKE8JGizBp5SgSkFiWzv33jdd886+LR5GlQwRRHlpx4/aKWpasuNSO6LjtPReX+O08rE5xodPeEoOvZtt9HwLULtaptfx/bdu0EOp7gstjyr0tOU5+iV1va8CF4t+D8qqWl9uBiGwYejaSZrEsdcpyZDLydQW8C+m6hZ6WRVfM9pw8Q35RfdAP7BzAq972rP1o3aDPL8cLqAAAADElEQVR4nGMQVDIGAACuAGcVHqFfAAAAAElFTkSuQmCC", "base64");
const payload = control.subarray(41, 41 + control.readUInt32BE(33));
const damaged = Buffer.from(payload);
damaged[damaged.length - 1]! ^= 1;
const bad = Buffer.concat([control.subarray(0, 33), makeChunk("iCCP", damaged), control.subarray(45 + payload.length)]);

// Native ImageMagick 7.1.2-31 Q16-HDRI: magick in.png out.png retains
// the complete profile despite the Adler mismatch (also reported on 7.1.2-35).
it.each(["buffered", "command"] as const)("retains ICC with only a bad Adler checksum (%s)", async mode => {
  expect(() => inflateSync(damaged.subarray(6))).toThrow("incorrect data check");
  expect(() => transformBytes(damaged.subarray(6), {direction: "decode", format: "zlib"})).toThrow("incorrect data check");
  for (const input of [control, bad]) {
    const files = new Map([["/in.png", input], ["/out.png", Buffer.from("keep")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/in.png", "/out.png"];
    const result = mode === "buffered" ? runConvertCliSync(args, files) : await createMagickCommand().execute({
      command: "magick", args: createCommandArguments(args).args, fs, cwd: "/", env: {},
      stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: {write: async () => {}}, stderr: {write: async () => {}}
    });
    expect(result.exitCode).toBe(0);
    const output = mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png");
    const decoded = decodeImage(output);
    expect(decoded.data).toEqual(Uint8Array.of(17, 34, 51, 255));
    expect(decoded.icc).toHaveLength(588);
    expect(createHash("sha256").update(decoded.icc!).digest("hex")).toBe("403735cf76fe3fba04841443e9db2a4d1030c712e2bf3004aca4b521849c08a7");
    expect(decoded.decodeWarnings).toBeUndefined();
  }
});

it("keeps the 16 MiB ICC limit when recovering a checksum mismatch", () => {
  const compressed = deflateSync(new Uint8Array(16 * 1024 * 1024 + 1));
  compressed[compressed.length - 1]! ^= 1;
  const oversized = Buffer.concat([control.subarray(0, 33), makeChunk("iCCP", Buffer.concat([payload.subarray(0, 6), compressed])), control.subarray(45 + payload.length)]);
  const files = new Map([["/in.png", oversized], ["/out.png", Buffer.from("keep")]]);
  const result = runConvertCliSync(["/in.png", "/out.png"], files);
  expect(result.exitCode).toBe(1);
  expect(result.stderr).toContain("ICC profile exceeds 16 MiB");
  expect(files.get("/out.png")).toEqual(Buffer.from("keep"));
});
