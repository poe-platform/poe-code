import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { it } from "node:test";
import { Volume } from "memfs";
import { createFfmpegCommand, evalSyncFfmpeg } from "./index.js";

// Generated independently with native FFmpeg from PCM16 [100, -200, 300, -400].
const fixtures = [["adpcm_ima_qt", "464f524d00000062414946434656455200000004a2805140434f4d4d000000180001000000010004400bfa00000000000000696d6134000053534e440000002a00000000000000000000f7f7828080808000080808088880808080800000000000000000000000000000", "1f1fd5a44d0d302f808556dfc0f46fe74af2ba8620068bbbca59b85f0670b044"]] as const;
for (const [codec, hex, decoded] of fixtures) {
  for (const sync of [false, true]) {
    it(`writes native-compatible ${codec} AIFC (${sync ? "sync" : "async"})`, async () => {
      const volume = Volume.fromJSON({});
      volume.writeFileSync("/in.aiff", Buffer.from("464f524d0000003641494646434f4d4d000000120001000000040010400bfa0000000000000053534e440000001000000000000000000064ff38012cfe70", "hex"));
      for (const copy of [false, true]) {
        const args = ["-y", "-v", "error", "-i", copy ? "/out.aiff" : "/in.aiff", "-c:a", copy ? "copy" : codec, copy ? "/copy.aiff" : "/out.aiff"];
        if (sync) {
          assert.equal(evalSyncFfmpeg(args, undefined,
            name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
            (name, data) => { volume.writeFileSync(name, data); return true; }), "");
        } else {
          let stderr = "";
          const result = await createFfmpegCommand().execute({
            args, cwd: "/", env: {}, signal: new AbortController().signal,
            fs: {
              async readFile(name: string) { return volume.readFileSync(name); },
              async writeFile(name: string, data: Uint8Array) { volume.writeFileSync(name, data); },
              async stat(name: string) { return volume.statSync(name); }
            },
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(data: Uint8Array) { stderr += new TextDecoder().decode(data); } }
          } as never);
          assert.equal(result.exitCode, 0, stderr);
        }
        assert.deepEqual(volume.readFileSync(copy ? "/copy.aiff" : "/out.aiff"), Buffer.from(hex, "hex"));
      }
      assert.equal(evalSyncFfmpeg(["-i", "/out.aiff", "-c:a", "pcm_s16le", "-f", "s16le", "/decoded.raw"], undefined,
        name => volume.existsSync(name) ? volume.readFileSync(name) as Buffer : undefined,
        (name, data) => { volume.writeFileSync(name, data); return true; }), "");
      assert.equal(createHash("sha256").update(volume.readFileSync("/decoded.raw") as Buffer).digest("hex"), decoded);
    });
  }
}
