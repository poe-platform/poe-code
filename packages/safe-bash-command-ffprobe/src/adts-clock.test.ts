import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

// Synthetic AAC fixtures and native ffprobe tick values; the MP4 contains the
// same 48 kHz payloads and keeps its sample-rate clock.
for (const [fixture, sampleRate, clock, ticks, count] of [
  ["adts-clock-44100.aac", 44100, 28224000, 655360, 11],
  ["adts-clock-48000.aac", 48000, 28224000, 602112, 12],
  ["adts-clock-control.m4a", 48000, 48000, 1024, 12]
] as const) for (const route of ["file", "stream", "stdin", "sync"]) {
  for (const section of ["streams", "packets", "frames"]) {
    it(`uses the demuxer clock for ${fixture} ${section} via ${route}`, async () => {
      const bytes = readFileSync(new URL(`./fixtures/${fixture}`, import.meta.url));
      const args = ["-v", "error", "-show_streams", ...(section === "streams" ? [] : [`-show_${section}`]),
        "-of", "json", route === "stdin" ? "-" : "/input"];
      let output = "", diagnostic = "";
      if (route === "sync") output = evalSyncFfprobe(undefined, args, () => bytes)!;
      else {
        const base = new MemoryFileSystem();
        await base.writeFile("/input", bytes);
        const capabilities = { ...base.capabilities, retainedRead: false, streamingRead: true };
        const fs = route === "stream" ? new Proxy(base, { get(target, key) {
          if (key === "capabilities") return capabilities;
          if (key === "capabilitiesFor") return async () => capabilities;
          const value = Reflect.get(target, key, target);
          return typeof value === "function" ? value.bind(target) : value;
        } }) : base;
        const result = await createFfprobeCommand().execute({
          command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
          signal: new AbortController().signal,
          stdin: { async *[Symbol.asyncIterator]() {
            for (let offset = 0; offset < bytes.length; offset += 71) yield bytes.subarray(offset, offset + 71);
          } },
          stdout: { async write(chunk) { output += new TextDecoder().decode(chunk); } },
          stderr: { async write(chunk) { diagnostic += new TextDecoder().decode(chunk); } }
        });
        expect(result.exitCode, diagnostic).toBe(0);
      }
      const probe = JSON.parse(output);
      expect(probe.streams[0]).toMatchObject({
        sample_rate: String(sampleRate), time_base: `1/${clock}`,
        duration_ts: count * ticks, duration: (count * 1024 / sampleRate).toFixed(6)
      });
      if (section === "streams") return;
      expect(probe[section]).toHaveLength(count);
      for (const [index, record] of probe[section].entries()) {
        const time = (index * 1024 / sampleRate).toFixed(6);
        const duration = (1024 / sampleRate).toFixed(6);
        expect(record).toMatchObject({ pts: index * ticks, pts_time: time });
        if (section === "packets") {
          expect(record).toMatchObject({
            dts: index * ticks, dts_time: time, duration: ticks, duration_time: duration
          });
        } else {
          expect(record).toMatchObject({
            pkt_dts: index * ticks, pkt_dts_time: time,
            best_effort_timestamp: index * ticks, best_effort_timestamp_time: time,
            duration: ticks, duration_time: duration, nb_samples: 1024
          });
          if (fixture.endsWith(".aac")) expect(record).toMatchObject({
            pkt_duration: ticks, pkt_duration_time: duration
          });
        }
      }
    });
  }
}
