import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

for (const runtime of ["TypeScript", "Rust"]) for (const writer of ["json", "json=c=1"]) for (const count of [0, 3]) {
  for (const fields of ["packet=pts:frame=pts", "packet=pos:frame=pkt_size"]) {
    test(`${runtime} ffprobe combined ${writer} ${count} records ${fields}`, {skip: !WebAssembly.Suspending}, async () => {
      const {Shell, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
      const {ffprobeCommands} = await import("safe-bash-command-ffprobe");
      const memory = createMemoryFileSystem();
      const shell = runtime === "TypeScript" ? new Shell({fs: memory, cwd: "/"}).use(ffprobeCommands())
        : new RustWasmBash({cwd: "/", forceNative: true});
      const bytes = Buffer.concat([Buffer.from("YUV4MPEG2 W4 H2 F25:1 Ip A1:1 C420jpeg\n"),
        ...Array.from({length: count}, () => Buffer.concat([Buffer.from("FRAME\n"), Buffer.alloc(12, 128)]))]);
      try {
        await (runtime === "TypeScript" ? memory : shell.fs).writeFile("/clip.y4m", bytes);
        const result = await shell.exec(`ffprobe -v error -show_packets -show_frames -show_entries ${fields} -of ${writer} /clip.y4m`);
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        const packets_and_frames = Array.from({length: count}, (_, pts) => fields === "packet=pts:frame=pts"
          ? [{type: "packet", pts}, {type: "frame", pts}]
          : [{type: "packet", pos: String(45 + 18 * pts)}, {type: "frame", pkt_size: "12"}]).flat();
        assert.deepEqual(JSON.parse(result.stdout), {packets_and_frames});
        if (runtime === "Rust") assert.equal(shell._companion, null);
      } finally {await shell.dispose();}
    });
  }
}
