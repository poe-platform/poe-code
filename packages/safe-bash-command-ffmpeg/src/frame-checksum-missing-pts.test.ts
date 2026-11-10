import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

// Packet rows and PCM bytes from FFmpeg 7.0.2, with eleven mono samples at 8 kHz.
const cases = [
  {
    filter: "asetpts=NAN", format: "framecrc", options: [],
    rows: [
      "0,          0,          0,        3,        6, 0x0a4f0285",
      "0,          3,          3,        3,        6, 0x075b01d1",
      "0,          6,          6,        3,        6, 0x0467011d",
      "0,          9,          9,        2,        4, 0x02cf0159"
    ]
  },
  {
    filter: "asetpts=NAN,areverse", format: "framecrc", options: [],
    rows: [
      "0,          0,          0,        2,        4, 0x04a50159",
      "0,          0,          0,        3,        6, 0x03c7011d",
      "0,          0,          0,        3,        6, 0x06bb01d1",
      "0,          0,          0,        3,        6, 0x09af0285"
    ]
  },
  {
    filter: "asetpts=if(eq(N\\,3)\\,NAN\\,PTS)", format: "framemd5", options: [],
    rows: [
      "0,          0,          0,        3,        6, f4a9e5429ccc07128a627ced487596dc",
      "0,          3,          3,        3,        6, 6eb625578300d972259c432476e73d69",
      "0,          6,          6,        3,        6, 5882016e3a19e5d86741bcedd38d67d1",
      "0,          9,          9,        2,        4, 4f8572fe416ae7faacf327aee9c2eb92"
    ]
  },
  {
    filter: "asetpts=NAN", format: "framehash", options: ["-frames:a", "1"],
    rows: ["0,          0,          0,        3,        6, 31017f7f9619e1ee2eb0c416251cd4fedcc43f5d709aafe0b959703f0115584c"]
  },
  {
    filter: "areverse", format: "framecrc", options: [],
    rows: [
      "0,          0,          0,        2,        4, 0x04a50159",
      "0,          2,          2,        3,        6, 0x03c7011d",
      "0,          5,          5,        3,        6, 0x06bb01d1",
      "0,          8,          8,        3,        6, 0x09af0285"
    ]
  },
  {
    filter: "asetpts=NAN", format: "s16le", options: [],
    hex: "e803d007b80ba00f88137017581b401f28231027f82a"
  }
];

for (const { filter, format, options, rows, hex } of cases) {
  for (const target of ["/out", "-"]) {
    it(`writes native ${format} timestamps and payloads for ${filter} to ${target}`, async () => {
      const input = Buffer.alloc(22);
      for (let i = 0; i < 11; i++) input.writeInt16LE((i + 1) * 1000, i * 2);
      const volume = Volume.fromJSON({ "/in.raw": input, "/out": "KEEP" });
      const stdout: Uint8Array[] = [];
      let stderr = "";
      const result = await createFfmpegCommand().execute({
        args: ["-y", "-v", "error", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "/in.raw",
          "-af", `asetnsamples=n=3:p=0,${filter}`, ...options, "-f", format, target],
        cwd: "/", env: {}, signal: new AbortController().signal,
        fs: {
          async readFile(path: string) { return volume.readFileSync(path); },
          async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
          async stat(path: string) { return volume.statSync(path); }
        },
        stdin: (async function* () {})(),
        stdout: { async write(bytes: Uint8Array) { stdout.push(bytes); } },
        stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
      } as never);
      assert.equal(result.exitCode, 0, stderr);
      const output = target === "-" ? Buffer.concat(stdout) : volume.readFileSync(target) as Buffer;
      if (hex) assert.equal(output.toString("hex"), hex);
      else assert.deepEqual(output.toString().split("\n").filter(line => line && !line.startsWith("#")), rows);
    });
  }
}
