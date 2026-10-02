import assert from "node:assert/strict";
import { it, mock } from "node:test";
import type { CommandContext } from "safe-bash-contracts/command";
import { registerYieldCheckpoint } from "safe-bash-contracts/yield";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

it("uses the cooperative command for synthetic sources", () => {
  let published = false;
  assert.equal(evalSyncFfmpeg(["-f", "lavfi", "-i", "sine=duration=1", "out.mp4"], undefined, undefined, () => {
    published = true;
    return true;
  }), undefined);
  assert.equal(published, false);
});

it("yields audio sample work and observes cancellation with frozen clocks", async () => {
  mock.method(performance, "now", () => 0);
  mock.method(Date, "now", () => 0);
  try {
    const controller = new AbortController();
    let turns = 0;
    let published = false;
    registerYieldCheckpoint(controller.signal, () => {
      if (++turns === 4) setTimeout(() => controller.abort(new Error("cancel samples")), 0);
    });
    const context = {
      args: ["-f", "lavfi", "-i", "sine=duration=1", "-ar", "48000", "out.wav"],
      cwd: "/", env: {}, signal: controller.signal,
      stdin: (async function* () {})(),
      fs: { async writeFile() { published = true; }, async stat() { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); }, async mkdir() {} },
      stdout: { async write() {} }, stderr: { async write() {} }
    } as unknown as CommandContext;
    try {
      const result = await createFfmpegCommand().execute(context);
      assert.notEqual(result.exitCode, 0);
    } catch (error) { assert.match(String(error), /cancel samples/); }
    assert.ok(turns >= 4);
    assert.equal(published, false);
  } finally { mock.restoreAll(); }
});

import { createSyntheticMp4 } from "@poe-code/mp4-ast";

for (const mode of ["audio resampling", "video frames"] as const) {
  it(`cancels ${mode} between work batches with frozen clocks`, async () => {
    const input = createSyntheticMp4({ width: 32, height: 32, frameCount: 30, fps: 30, includeAudio: true });
    mock.method(performance, "now", () => 0);
    mock.method(Date, "now", () => 0);
    try {
      const controller = new AbortController();
      let turns = 0;
      let published = false;
      registerYieldCheckpoint(controller.signal, () => {
        if (++turns === 4) setTimeout(() => controller.abort(new Error("cancel media")), 0);
      });
      const context = {
        args: mode === "audio resampling" ? ["-i", "in.mp4", "-vn", "-ar", "48000", "out.wav"] : ["-i", "in.mp4", "out%02d.png"],
        cwd: "/", env: {}, signal: controller.signal,
        stdin: (async function* () {})(),
        fs: { async readFile() { return input; }, async writeFile() { published = true; }, async stat() { throw Object.assign(new Error("ENOENT"), { code: "ENOENT" }); }, async mkdir() {} },
        stdout: { async write() {} }, stderr: { async write() {} }
      } as unknown as CommandContext;
      let result;
      try { result = await createFfmpegCommand().execute(context); }
      catch (error) { assert.match(String(error), /cancel media/); }
      if (result) assert.notEqual(result.exitCode, 0);
      assert.ok(turns >= 4);
      assert.equal(published, false);
    } finally { mock.restoreAll(); }
  });
}

import { muxMp4, muxMp4Steps, parseMp4 } from "@poe-code/mp4-ast";
import { yieldTurn } from "safe-bash-contracts/yield";

it("MP4 muxing yields tracks under frozen clocks and preserves output", async () => {
  const base = parseMp4(createSyntheticMp4({ width: 16, height: 16, frameCount: 1 }));
  const sources = Array.from({ length: 40 }, () => base);
  mock.method(performance, "now", () => 0);
  mock.method(Date, "now", () => 0);
  try {
    const work = muxMp4Steps(sources);
    let turns = 0;
    let timerFired = false;
    setTimeout(() => { timerFired = true; }, 0);
    let step = work.next();
    while (!step.done) {
      await yieldTurn();
      turns++;
      step = work.next();
    }
    assert.ok(turns > 1);
    assert.ok(timerFired);
    assert.deepEqual(step.value, muxMp4(sources));
  } finally { mock.restoreAll(); }
});

it("declines synchronous overwrites unless -y is explicit", () => {
  const input = createSyntheticMp4({ width: 16, height: 16, frameCount: 1, includeAudio: false });
  let published = false;
  const read = () => input;
  const write = () => { published = true; return true; };
  assert.equal(evalSyncFfmpeg(["-i", "in.mp4", "-c", "copy", "out.mp4"], undefined, read, write), undefined);
  assert.equal(published, false);
  assert.equal(evalSyncFfmpeg(["-y", "-i", "in.mp4", "-c", "copy", "out.mp4"], undefined, read, write), "");
  assert.equal(published, true);
});
