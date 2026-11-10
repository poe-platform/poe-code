import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(split: boolean, format: string, select = false, reversed = false, prefix?: string) {
  const input = Buffer.alloc(22);
  for (let i = 0; i < 11; i++) input.writeInt16LE((i + 1) * 100, i * 2);
  const volume = Volume.fromJSON({ "/in.raw": input });
  const inputArgs = ["-f", "s16le", "-ac", "1", "-ar", "1000", "-i", "/in.raw"];
  const graph = split
    ? "[0:a]asetnsamples=n=4:p=0,asplit[a][b];[b]areverse[r];"
    : "[0:a]asetnsamples=n=4:p=0[a];[1:a]asetnsamples=n=4:p=0,areverse[r];";
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-v", "error", ...inputArgs, ...(split ? [] : inputArgs), "-filter_complex",
      (prefix ?? graph) + `${reversed ? "[r][a]" : "[a][r]"}amerge${select ? ",aselect=eq(n\\,1)" : ""}[out]`,
      "-map", "[out]", "-c:a", "pcm_s16le", "-f", format, "/out"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(), stdout: { async write() {} },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  assert.equal(result.exitCode, 0, stderr);
  const output = volume.readFileSync("/out") as Buffer;
  return format === "framecrc"
    ? output.toString().split("\n").filter(line => line && !line.startsWith("#")).map(line => line.split(",").map(field => field.trim()).join(","))
    : Array.from({ length: output.length / 2 }, (_, i) => output.readInt16LE(i * 2));
}

it("amerge consumes queued split samples across frame boundaries after areverse", async () => {
  assert.deepEqual(await run(true, "s16le", true), [400, 800, 500, 700, 600, 600, 700, 500]);
});

it("amerge preserves native split/reverse packet sizes, clocks and checksums", async () => {
  assert.deepEqual(await run(true, "framecrc"), [
    "0,0,0,3,12,0x1549031b", "0,3,3,4,16,0x27a204ce", "0,7,7,4,16,0x203503cf"
  ]);
});

it("amerge retains separate-input frame boundaries when one input is reversed", async () => {
  assert.deepEqual(await run(false, "s16le", true), [400, 800]);
});

it("amerge preserves all split/reverse PCM samples", async () => {
  assert.deepEqual(await run(true, "s16le"), Array.from({ length: 11 }, (_, i) => [(i + 1) * 100, (11 - i) * 100]).flat());
});

it("amerge keeps split scheduling when the reversed branch is connected first", async () => {
  assert.deepEqual(await run(true, "framecrc", false, true), [
    "0,0,0,3,12,0x161b031b", "0,3,3,4,16,0x26c604ce", "0,7,7,4,16,0x203f03cf"
  ]);
});

it("amerge does not queue either branch when reverse precedes the split", async () => {
  assert.deepEqual(await run(true, "s16le", true, false,
    "[0:a]asetnsamples=n=4:p=0,areverse,asplit[a][r];"),
  [800, 800, 700, 700, 600, 600, 500, 500]);
});

it("amerge keeps both reversed branches' frame boundaries", async () => {
  assert.deepEqual(await run(true, "s16le", true, false,
    "[0:a]asetnsamples=n=4:p=0,asplit[x][y];[x]areverse[a];[y]areverse[r];"),
  [800, 800, 700, 700, 600, 600, 500, 500]);
});

it("amerge tracks split queues through intermediate branch filters", async () => {
  assert.deepEqual(await run(true, "s16le", true, false,
    "[0:a]asetnsamples=n=4:p=0,asplit[x][y];[x]anull[a];[y]anull[z];[z]areverse[r];"),
  [400, 800, 500, 700, 600, 600, 700, 500]);
});
