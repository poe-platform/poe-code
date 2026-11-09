import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { y4mAst } from "@poe-code/mp4-ast";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

for (const tagged of [false, true]) {
  const input = Buffer.concat([
    Buffer.from("YUV4MPEG2 W4 H2 F25:1 Ip A1:1 C420jpeg\n"),
    ...[0, 1, 2].flatMap(frame => [
      Buffer.from(tagged && frame !== 1 ? `FRAME ${frame === 0 ? "Xlong=hello" : "Xt=12"}\n` : "FRAME\n"),
      Buffer.from(Array.from({ length: 12 }, (_, i) => 16 + frame * 20 + i * 7))
    ])
  ]);
  for (const route of ["file", "sync"] as const) {
    for (const show of [false, true]) {
      it(`separates Y4M estimated duration from actual counts (tags=${tagged}, ${route}, records=${show})`, async () => {
        const args = ["-v", "error", "-count_packets", "-count_frames",
          "-show_entries", "stream=duration_ts,duration,nb_frames,nb_read_packets,nb_read_frames:format=duration" +
            (show ? ":packet=pts:frame=pts" : ""), "-of", "json", "/input.y4m"];
        let output = "";
        if (route === "sync") output = evalSyncFfprobe(input, args, () => input)!;
        else {
          const fs = new MemoryFileSystem();
          await fs.writeFile("/input.y4m", input);
          const result = await createFfprobeCommand().execute({
            command: "ffprobe", ...createCommandArguments(args), cwd: "/", env: {}, fs,
            signal: new AbortController().signal,
            stdin: (async function* () { yield input; })(),
            stdout: { async write(bytes) { output += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { throw new Error(new TextDecoder().decode(bytes)); } }
          });
          expect(result.exitCode).toBe(0);
        }
        const duration = { duration_ts: tagged ? 4 : 3, duration: tagged ? "0.160000" : "0.120000" };
        const result = JSON.parse(output);
        expect(result.streams).toEqual([{ ...duration, nb_read_packets: "3", nb_read_frames: "3" }]);
        expect(result.format).toEqual({ duration: duration.duration });
        if (show) {
          expect(result.packets_and_frames.filter((record: { type: string }) => record.type === "packet").map((record: { pts: number }) => record.pts)).toEqual([0, 1, 2]);
          expect(result.packets_and_frames.filter((record: { type: string }) => record.type === "frame").map((record: { pts: number }) => record.pts)).toEqual([0, 1, 2]);
        }
        const doc = y4mAst().parse(input);
        expect(doc.durationSeconds).toBe(0.12);
        expect(doc.tracks[0]?.samples).toHaveLength(3);
      });
    }
  }
}
