import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { decodeImage } from "@poe-code/image-ast/portable";
import { createFfmpegCommand } from "./index.js";

for (const [alias, width, height] of [["qcif", 176, 144], ["qqvga", 160, 120]] as const) {
  for (const key of ["s", "size"]) {
    it(`renders color ${key}=${alias} like its numeric size`, async () => {
      const named = await run(`color=red:${key}=${alias}:r=1:d=1`);
      const numeric = await run(`color=red:${key}=${width}x${height}:r=1:d=1`);
      for (const result of [named, numeric]) {
        assert.equal(result.exitCode, 0, result.stderr);
        const image = decodeImage(result.stdout);
        assert.equal(image.width, width);
        assert.equal(image.height, height);
        assert.deepEqual([...image.data.subarray(0, 4)], [253, 0, 0, 255]);
      }
      assert.deepEqual(named.stdout, numeric.stdout);
    });
  }
}

it("retains the default color size when omitted", async () => {
  const result = await run("color=red:r=1:d=1");
  assert.equal(result.exitCode, 0, result.stderr);
  const image = decodeImage(result.stdout);
  assert.equal(image.width, 320);
  assert.equal(image.height, 240);
});

for (const source of ["testsrc", "testsrc2", "smptebars"]) {
  it(`resolves size aliases in the shared ${source} generator`, async () => {
    const named = await run(`${source}=s=qqvga:r=1:d=1`);
    const numeric = await run(`${source}=s=160x120:r=1:d=1`);
    assert.equal(named.exitCode, 0, named.stderr);
    assert.equal(numeric.exitCode, 0, numeric.stderr);
    assert.deepEqual(named.stdout, numeric.stdout);
  });
}

for (const size of ["QCIF", "unknown", "", "0x144", "176x0", "176", "176x144junk"]) {
  it(`rejects invalid color size ${JSON.stringify(size)} without replacing output`, async () => {
    const result = await run(`color=red:s=${size}:r=1:d=1`, "/out.png");
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("Invalid image size"), result.stderr);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.volume.readFileSync("/out.png", "utf8"), "KEEP");
  });
}

async function run(source: string, output = "pipe:1") {
  const volume = Volume.fromJSON({ "/out.png": "KEEP" });
  const stdout: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-y", "-v", "error", "-f", "lavfi", "-i", source,
      "-frames:v", "1", "-c:v", "png", "-f", "image2pipe", output],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { stdout.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, stdout: Buffer.concat(stdout), stderr, volume };
}
