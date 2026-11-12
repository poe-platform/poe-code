import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Native FFmpeg: -f rawvideo -pix_fmt rgb24 -s 8x4 -r 2 -i in.raw -c:v png in.mov.
const movie = Buffer.from("AAAAFGZ0eXBxdCAgAAACAHF0ICAAAAAId2lkZQAAAORtZGF0iVBORw0KGgoAAAANSUhEUgAAAAgAAAAECAIAAAA8r+mnAAAACXBIWXMAAAAAAAAAAQCEeRdzAAAAHUlEQVR4nGNkMM0SxwZYNDU1sYlrYkpoYurQRKYB+fMJ8jiB5loAAAAASUVORK5CYIKJUE5HDQoaCgAAAA1JSERSAAAACAAAAAQIAgAAADyv6acAAAAJcEhZcwAAAAAAAAABAIR5F3MAAAAjSURBVHicY2wLlHmJDbBcv34dzLiOSsAlrkMVXsfQgRCCAAA1BlSY2p0CFwAAAABJRU5ErkJgggAAArltb292AAAAbG12aGQAAAAAAAAAAAAAAAAAAAPoAAAD6AABAAABAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAACJXRyYWsAAABcdGtoZAAAAAMAAAAAAAAAAAAAAAEAAAAAAAAD6AAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAAAAAAEAAAAAAAAAAAAAAAAAAEAAAAAACAAAAAQAAAAAACRlZHRzAAAAHGVsc3QAAAAAAAAAAQAAA+gAAAAAAAEAAAAAAZ1tZGlhAAAAIG1kaGQAAAAAAAAAAAAAAAAAAEAAAABAAH//AAAAAAAtaGRscgAAAABtaGxydmlkZQAAAAAAAAAAAAAAAAxWaWRlb0hhbmRsZXIAAAFIbWluZgAAABR2bWhkAAAAAQAAAAAAAAAAAAAALGhkbHIAAAAAZGhscnVybCAAAAAAAAAAAAAAAAALRGF0YUhhbmRsZXIAAAAkZGluZgAAABxkcmVmAAAAAAAAAAEAAAAMdXJsIAAAAAEAAADcc3RibAAAAHBzdHNkAAAAAAAAAAEAAABgcG5nIAAAAAAAAAABAAAAAEZGTVAAAAIAAAACAAAIAAQASAAAAEgAAAAAAAAAARBMYXZjNjMuMS4xMDEgcG5nAAAAAAAAAAAAAAAAAAAAABj//wAAAApmaWVsAQAAAAAYc3R0cwAAAAAAAAABAAAAAgAAIAAAAAAcc3RzYwAAAAAAAAABAAAAAQAAAAIAAAABAAAAHHN0c3oAAAAAAAAAAAAAAAIAAABrAAAAcQAAABRzdGNvAAAAAAAAAAEAAAAkAAAAIHVkdGEAAAAYqXN3cgAMVcRMYXZmNjMuMS4xMDE=", "base64");
const first = Buffer.from(Array.from({ length: 96 }, (_, i) =>
  (Math.floor(i / 3) % 8 * 23 + Math.floor(i / 24) * 41 + i % 3 * 53) % 256));
const second = Buffer.from(first).reverse();

for (const trim of [false, true]) {
  it(`decodes native PNG MOV frames to exact RGB pixels${trim ? " after seeking" : ""}`, async () => {
    const volume = Volume.fromJSON({ "/in.mov": movie });
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const result = await createFfmpegCommand().execute({
      args: ["-v", "error", "-i", "/in.mov", ...(trim ? ["-ss", "0.5"] : []),
        "-pix_fmt", "rgb24", "-f", "rawvideo", "pipe:1"],
      cwd: "/", env: {}, signal: new AbortController().signal,
      fs: {
        async readFile(path: string) { return volume.readFileSync(path); },
        async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
        async stat(path: string) { return volume.statSync(path); }
      },
      stdin: (async function* () {})(),
      stdout: { async write(bytes: Uint8Array) { chunks.push(bytes); } },
      stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
    } as never);
    assert.equal(result.exitCode, 0, stderr);
    assert.deepEqual(Buffer.concat(chunks), trim ? second : Buffer.concat([first, second]));
  });
}
