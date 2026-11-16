import assert from "node:assert/strict";
import test from "node:test";
import {RustWasmBash} from "./index.js";

const payloads = ["10171e252c333a41484f565d", "242b323940474e555c636a71", "383f464d545b626970777e85"].map(hex => Buffer.from(hex, "hex"));
for (const runtime of ["TypeScript", "Rust"]) for (const tagged of [false, true]) for (const rate of ["25:1", "30000:1001"]) for (const stdin of [false, true]) {
  test(`${runtime} Y4M ${tagged ? "tagged" : "plain"} ${rate} ${stdin ? "stdin" : "file"} positions`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
    const {ffprobeCommands} = await import("safe-bash-command-ffprobe");
    const memory = createMemoryFileSystem();
    const shell = runtime === "TypeScript" ? new Shell({fs: memory, cwd: "/"}).use(ffprobeCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    const header = Buffer.from(`YUV4MPEG2 W4 H2 F${rate} Ip A1:1 C420jpeg\n`);
    const tags = tagged ? ["FRAME Xlong=hello\n", "FRAME\n", "FRAME Xt=12\n"] : ["FRAME\n", "FRAME\n", "FRAME\n"];
    const bytes = Buffer.concat([header, ...payloads.flatMap((p, i) => [Buffer.from(tags[i]), p])]);
    // These offsets and frame ticks were checked with native ffprobe, not this parser.
    const offsets = (tagged ? [57, 75, 99] : [45, 63, 81]).map(pos => pos + (rate === "25:1" ? 0 : 6));
    try {
      await (runtime === "TypeScript" ? memory : shell.fs).writeFile("/clip.y4m", bytes);
      for (const section of ["packets", "frames"]) {
        const flags = `-show_${section}`;
        const result = await shell.exec(`ffprobe -v error ${flags} -of json ${stdin ? "-" : "/clip.y4m"}`, {stdin: stdin ? bytes : undefined});
        assert.equal(result.exitCode, 0, result.stderr);
        assert.equal(result.stderr, "");
        const rows = JSON.parse(result.stdout)[section];
        assert.equal(rows.length, 3);
        for (const [i, row] of rows.entries()) {
          const frame = section === "frames";
          assert.equal(row.pts, i);
          assert.equal(row[frame ? "pkt_pos" : "pos"], String(offsets[i]));
          assert.equal(row[frame ? "pkt_size" : "size"], "12");
          assert.equal(row.duration ?? row.pkt_duration, 1);
          assert.equal(row.pts_time, (i * (rate === "25:1" ? 1 / 25 : 1001 / 30000)).toFixed(6));
        }
      }
      const metadata = await shell.exec(`ffprobe -v error -show_entries stream=time_base,r_frame_rate -of json ${stdin ? "-" : "/clip.y4m"}`, {stdin: stdin ? bytes : undefined});
      assert.equal(metadata.exitCode, 0, metadata.stderr);
      assert.deepEqual(JSON.parse(metadata.stdout).streams, [{r_frame_rate: rate.replace(":", "/"), time_base: rate.split(":").reverse().join("/")}]);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}

for (const runtime of ["TypeScript", "Rust"]) for (const rate of ["", " F0:0", " Fbad", " F50:2"]) {
  test(`${runtime} Y4M frame-rate fallback and reduction ${JSON.stringify(rate)}`, {skip: !WebAssembly.Suspending}, async () => {
    const {Shell, createMemoryFileSystem} = await import("@poe-platform/safe-bash");
    const {ffprobeCommands} = await import("safe-bash-command-ffprobe");
    const memory = createMemoryFileSystem();
    const shell = runtime === "TypeScript" ? new Shell({fs: memory, cwd: "/"}).use(ffprobeCommands())
      : new RustWasmBash({cwd: "/", forceNative: true});
    try {
      const bytes = Buffer.concat([Buffer.from(`YUV4MPEG2 W4 H2${rate} Ip A1:1 C420jpeg\nFRAME\n`), payloads[0]]);
      const result = await shell.exec("ffprobe -v error -show_entries stream=time_base,r_frame_rate -of json -", {stdin: bytes});
      assert.equal(result.exitCode, 0, result.stderr);
      assert.deepEqual(JSON.parse(result.stdout).streams, [{r_frame_rate: "25/1", time_base: "1/25"}]);
      if (runtime === "Rust") assert.equal(shell._companion, null);
    } finally {await shell.dispose();}
  });
}
