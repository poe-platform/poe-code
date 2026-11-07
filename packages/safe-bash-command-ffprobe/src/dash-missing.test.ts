import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createSyntheticMp4, parseMp4, serializeDashDocument, dashAst, MediaBudgetTracker, hlsAst } from "@poe-code/mp4-ast";
import { createCommandArguments } from "safe-bash-contracts/command";
import native from "./fixtures/dash-partial.json" with { type: "json" };
import { loadManifestResources } from "./media.js";
import { createFfmpegCommand } from "safe-bash-command-ffmpeg";

for (const fixture of ["synthetic", "native"]) for (const missing of ["chunk-stream0-00001.m4s", "chunk-stream0-00002.m4s", "init-stream0.m4s"]) {
  it(`copies a partial DASH ${fixture} recording with missing ${missing}`, async () => {
    const fs = new MemoryFileSystem();
    const base = parseMp4(createSyntheticMp4({ width: 32, height: 24, fps: 4, frameCount: 12, includeAudio: true }));
    const synthetic = { ...base, tracks: base.tracks.map(track => ({ ...track,
      samples: track.samples.map((sample, index) => ({ ...sample, isKeyframe: track.type === "audio" || index % 4 === 0 }))
    })) };
    let { manifest, resources } = serializeDashDocument(synthetic, { segmentDuration: 1 });
    if (fixture === "native") {
      resources = new Map(Object.entries(native.files).map(([uri, data]) => [uri, new Uint8Array(Buffer.from(data, "base64"))]));
      manifest = resources.get("in.mpd")!;
    }
    await fs.writeFile("/input.mpd", manifest);
    for (const [uri, bytes] of resources) if (uri !== missing) await fs.writeFile(`/${uri}`, bytes);
    let diagnostic = "";
    const command = createFfmpegCommand();
    const context: Parameters<typeof command.execute>[0] = {
      command: "ffmpeg", ...createCommandArguments(["-y", "-i", "/input.mpd", "-map", "0", "-c", "copy", "/output.mp4"]),
      cwd: "/", env: {}, fs, signal: new AbortController().signal,
      stdin: { async *[Symbol.asyncIterator]() {} },
      stdout: { async write() {} },
      stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
    };
    const result = await command.execute(context);
    if (missing.startsWith("init")) {
      expect(result.exitCode).toBe(1);
      expect(diagnostic).toContain("ENOENT");
      await expect(fs.readFile("/output.mp4")).rejects.toMatchObject({ code: "ENOENT" });
      return;
    }
    expect(result.exitCode, diagnostic).toBe(0);
    const output = parseMp4(await fs.readFile("/output.mp4"));
    if (fixture === "native") {
      expect(output.tracks.map(track => track.samples.length)).toEqual([8, 24]);
      expect(output.tracks[1]!.language).toBe("fra");
    }
    await fs.writeFile(`/${missing}`, resources.get(missing)!);
    expect((await command.execute(context)).exitCode, diagnostic).toBe(0);
    const source = parseMp4(await fs.readFile("/output.mp4"));
    const start = missing.includes("00001") ? 0 : 4;
    for (const track of source.tracks) {
      const actual = output.tracks.find(candidate => candidate.type === track.type)!;
      const expected = track.samples.filter((_, index) => track.type === "audio" || index < start || index >= start + 4);
      const delay = (actual.editList?.filter(edit => edit.mediaTime < 0).reduce((sum, edit) => sum + edit.segmentDuration, 0) ?? 0) / output.timescale;
      const sourceDelay = (track.editList?.filter(edit => edit.mediaTime < 0).reduce((sum, edit) => sum + edit.segmentDuration, 0) ?? 0) / source.timescale;
      const sourceOffset = track.editList?.find(edit => edit.mediaTime >= 0)?.mediaTime ?? 0;
      const outputOffset = actual.editList?.find(edit => edit.mediaTime >= 0)?.mediaTime ?? 0;
      expect(actual.samples.map(sample => [(sample.dts - outputOffset) / actual.timescale + delay, (sample.pts - outputOffset) / actual.timescale + delay, sample.data]))
        .toEqual(expected.map(sample => [(sample.dts - sourceOffset) / track.timescale + sourceDelay, (sample.pts - sourceOffset) / track.timescale + sourceDelay, sample.data]));
    }
  });
}

for (const [plugin, code] of [[dashAst(), "EACCES"], [hlsAst(), "ENOENT"]] as const) {
  it(`does not suppress ${plugin.id} ${code} resource failures`, async () => {
    const manifest = new TextEncoder().encode(plugin.id === "dash"
      ? '<MPD mediaPresentationDuration="PT1S"><Period><AdaptationSet><Representation id="0"><SegmentTemplate initialization="init.m4s" media="$Number$.m4s" duration="1"/></Representation></AdaptationSet></Period></MPD>'
      : '#EXTM3U\n#EXT-X-MAP:URI="init.m4s"\n#EXTINF:1,\n1.m4s\n#EXT-X-ENDLIST');
    const error = Object.assign(new Error(code), { code });
    await expect(loadManifestResources(plugin, manifest, "/in", "/", async path => {
      if (path === "/init.m4s") return new Uint8Array();
      throw error;
    }, new MediaBudgetTracker())).rejects.toBe(error);
  });
}

it("rejects malformed DASH manifests before reading resources", async () => {
  await expect(loadManifestResources(dashAst(), new TextEncoder().encode("<MPD/>"), "/in", "/", async () => {
    throw new Error("must not read resources");
  }, new MediaBudgetTracker())).rejects.toThrow("DASH requires a single Period");
});
