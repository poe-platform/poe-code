import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { aiffAst } from "@poe-code/mp4-ast";
import { createFfmpegCommand } from "safe-bash-command-ffmpeg";
import { createFfprobeCommand, evalSyncFfprobe } from "./media.js";

const comm = Buffer.from("434f4d4d000000120001000000090010400bfa00000000000000", "hex");
const samples = Buffer.from("000100020003000400050006000700080009", "hex");

for (const offset of [false, true]) for (const soundFirst of [false, true]) {
  const sound = Buffer.concat([
    Buffer.from(offset ? "53534e440000001d0000000300000004585858" : "53534e440000001a0000000000000000", "hex"),
    samples, ...(offset ? [Buffer.from([0])] : [])
  ]);
  const bytes = Buffer.concat([Buffer.from("464f524d0000000041494646", "hex"), ...(soundFirst ? [sound, comm] : [comm, sound])]);
  bytes.writeUInt32BE(bytes.length - 8, 4);

  it(`honors explicit AIFF seekability with soundFirst=${soundFirst}, offset=${offset}`, () => {
    expect(() => aiffAst().parse(bytes, { seekable: true })).not.toThrow();
    if (soundFirst) expect(() => aiffAst().parse(bytes, { seekable: false })).toThrow("file is not seekable");
    else expect(() => aiffAst().parse(bytes, { seekable: false })).not.toThrow();
  });

  for (const input of ["/in.aiff", "pipe:0", "pipe:", "-"]) for (const command of ["ffmpeg", "ffprobe"]) {
    it(`${command} handles ${input} with soundFirst=${soundFirst}, offset=${offset}`, async () => {
      const fs = new MemoryFileSystem();
      await fs.writeFile("/in.aiff", bytes);
      await fs.writeFile("/out.raw", Buffer.from("KEEP"));
      const args = command === "ffmpeg"
        ? ["-y", "-v", "error", "-i", input, "-f", "s16le", "/out.raw"]
        : ["-v", "error", "-show_streams", "-of", "json", input];
      let stdout = "", stderr = "";
      const result = await (command === "ffmpeg" ? createFfmpegCommand() : createFfprobeCommand()).execute({
        command, ...createCommandArguments(args), cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () { yield bytes; })(),
        stdout: { async write(data) { stdout += new TextDecoder().decode(data); } },
        stderr: { async write(data) { stderr += new TextDecoder().decode(data); } }
      });
      const rejected = soundFirst && input !== "/in.aiff";
      expect(result.exitCode, stderr).toBe(rejected ? 1 : 0);
      if (command === "ffprobe") {
        const sync = evalSyncFfprobe(bytes, args, () => bytes);
        if (rejected) expect(sync).toBeUndefined();
        else expect(JSON.parse(sync!)).toEqual(JSON.parse(stdout));
      }
      if (rejected) expect(stderr).toContain("file is not seekable");
      if (command === "ffmpeg") {
        expect(Buffer.from(await fs.readFile("/out.raw"))).toEqual(rejected ? Buffer.from("KEEP") : Buffer.from(samples).swap16());
      } else if (!rejected) {
        expect(JSON.parse(stdout).streams[0]).toMatchObject({ codec_name: "pcm_s16be", nb_frames: "9" });
      }
    });
  }
}
