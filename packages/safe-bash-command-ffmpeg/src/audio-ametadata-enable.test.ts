import assert from "node:assert/strict";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand } from "./index.js";

async function run(enable: string, addEnable = "") {
  const input = Buffer.from("e803d007b80ba00f88137017581b401f28231027", "hex");
  const volume = Volume.fromJSON({ "/in.raw": input, "/tags": "KEEP" });
  const output: Buffer[] = [];
  let stderr = "";
  const result = await createFfmpegCommand().execute({
    args: ["-hide_banner", "-nostats", "-v", "info", "-f", "s16le", "-ar", "8000", "-ac", "1", "-i", "in.raw",
      "-af", `asetnsamples=n=3:p=0,ametadata=mode=add:key=label:value=sample${addEnable},ametadata=mode=print:file=tags${enable}`,
      "-f", "s16le", "-"],
    cwd: "/", env: {}, signal: new AbortController().signal,
    fs: {
      async readFile(path: string) { return volume.readFileSync(path); },
      async writeFile(path: string, bytes: Uint8Array) { volume.writeFileSync(path, bytes); },
      async stat(path: string) { return volume.statSync(path); }
    },
    stdin: (async function* () {})(),
    stdout: { async write(bytes: Uint8Array) { output.push(Buffer.from(bytes)); } },
    stderr: { async write(bytes: Uint8Array) { stderr += new TextDecoder().decode(bytes); } }
  } as never);
  return { ...result, volume, input, stdout: Buffer.concat(output), stderr };
}

const rows = [
  "frame:0    pts:0       pts_time:0\nlabel=sample\n",
  "frame:1    pts:3       pts_time:0.000375\nlabel=sample\n",
  "frame:2    pts:6       pts_time:0.00075\nlabel=sample\n",
  "frame:3    pts:9       pts_time:0.001125\nlabel=sample\n"
];

for (const [enable, frames] of [
  ["", [0, 1, 2, 3]],
  [":enable=lt(n\\,2)", [0, 1]],
  [":enable='gte(t,0.00075)'", [2, 3]],
  [":enable=0", []],
  [":enable=1", [0, 1, 2, 3]]
] as const) {
  it(`ametadata print preserves PCM and selects frames with ${enable || "no timeline"}`, async () => {
    const result = await run(enable);
    assert.equal(result.exitCode, 0, result.stderr);
    assert.deepEqual(result.stdout, result.input);
    assert.equal(result.volume.readFileSync("/tags", "utf8"), frames.map(n => rows[n]).join(""));
  });
}

for (const enable of ["", "unknown", "lt(n,)"]) {
  it(`rejects invalid timeline ${enable} before writing output`, async () => {
    const result = await run(`:enable='${enable}'`);
    assert.notEqual(result.exitCode, 0);
    assert.ok(result.stderr.includes("ametadata enable"), result.stderr);
    assert.equal(result.stdout.length, 0);
    assert.equal(result.volume.readFileSync("/tags", "utf8"), "KEEP");
  });
}

it("ametadata add bypasses disabled frames without renumbering later reports", async () => {
  const result = await run("", ":enable='gte(n,2)'");
  assert.equal(result.exitCode, 0, result.stderr);
  assert.deepEqual(result.stdout, result.input);
  assert.equal(result.volume.readFileSync("/tags", "utf8"), rows.slice(2).join(""));
});
