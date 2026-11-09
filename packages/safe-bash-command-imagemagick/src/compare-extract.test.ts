import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI reference values for 4x2 PGM inputs.
const cases = [
  { inputs: ["-extract", "2x2+0+0", "a.pgm", "b.pgm"], metric: "0 (0)", size: [2, 2], gray: [206, 208, 214, 216] },
  { inputs: ["-extract", "2x2+2+0", "a.pgm", "b.pgm"], metric: "20560 (0.313725)", size: [2, 2], gray: [210, 32, 218, 220] },
  { inputs: ["a.pgm", "-extract", "2x2+0+0", "b.pgm"], metric: "2873.35 (0.0438445)", size: [4, 2], gray: [206, 208, 30, 32, 214, 216, 38, 40] },
  { inputs: ["a.pgm", "-extract", "2x2+2+0", "b.pgm"], metric: "26985 (0.411765)", size: [4, 2], gray: [26, 28, 30, 32, 34, 36, 38, 220] },
  { inputs: ["a.pgm", "b.pgm", "-extract", "2x2+0+0"], metric: "14538.1 (0.221837)", size: [4, 2] },
  { inputs: ["-extract", "2x2+0+0", "+extract", "a.pgm", "b.pgm"], metric: "14538.1 (0.221837)", size: [4, 2] },
  { inputs: ["-extract", "2x2+0+0", "a.pgm", "+extract", "b.pgm[2x2+0+0]"], metric: "0 (0)", size: [2, 2] },
  { inputs: ["-extract", "2x2+2+0", "a.pgm[2x2+0+0]", "b.pgm[2x2+0+0]"], metric: "0 (0)", size: [2, 2] },
  { inputs: ["-extract", "2x2", "a.pgm", "b.pgm"], metric: "10874.6 (0.165935)", size: [2, 1], black: true },
];

for (const mode of ["buffered", "sync", "retained", "compare", "magick"] as const) {
  for (const fixture of cases) {
    it(`${mode} compare applies ${fixture.inputs.join(" ")}`, async () => {
      const samples = fixture.black ? [0, 0, 0, 0, 0, 0, 0, 0] : [10, 20, 30, 40, 50, 60, 70, 80];
      const a = Uint8Array.from([...new TextEncoder().encode("P5\n4 2\n255\n"), ...samples]);
      const b = a.slice();
      b[b.length - 5] = fixture.black ? 255 : 200;
      const files = new Map([["a.pgm", a], ["b.pgm", b]]), filesystem = new MemoryFileSystem();
      for (const [name, bytes] of files) await filesystem.writeFile(`/${name}`, bytes);
      const args = ["-metric", "RMSE", ...fixture.inputs, "diff.ppm"];
      let stderr = "";
      let stdout = "";
      const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
      const result = mode === "compare" || mode === "magick" ? await command.execute({
        command: command.name, args: createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]).args,
        cwd: "/", env: {}, fs: filesystem, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }) : mode === "sync" ? runCompareCliSync(args, files)
        : await runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(fixture.metric === "0 (0)" ? 0 : 1);
      expect("stderr" in result ? result.stderr : stderr).toBe(fixture.metric);
      expect("stdout" in result ? result.stdout : stdout).toBe("");
      const image = decodeImage(mode === "buffered" || mode === "sync" ? files.get("diff.ppm")! : await filesystem.readFile("/diff.ppm"));
      expect([image.width, image.height]).toEqual(fixture.size);
      if (fixture.gray) expect([...image.data]).toEqual(fixture.gray.flatMap(value => [value, value, value, 255]));
    });
  }

  for (const options of [["-extract"], ["-extract", "bogus"], ["-extract", ""]]) {
    it(`${mode} compare rejects ${JSON.stringify(options)} without replacing output`, async () => {
      const original = new TextEncoder().encode("KEEP"), files = new Map([["diff.ppm", original]]), filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/diff.ppm", original);
      const args = ["a.pgm", "b.pgm", "diff.ppm", ...options];
      let stderr = "";
      const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
      const result = mode === "compare" || mode === "magick" ? await command.execute({
        command: command.name, args: createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]).args,
        cwd: "/", env: {}, fs: filesystem, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
      }) : mode === "sync" ? runCompareCliSync(args, files)
        : await runCompareCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
      expect(result.exitCode).toBe(2);
      expect("stderr" in result ? result.stderr : stderr).toBe(options.length === 1
        ? "compare: missing an argument for option '-extract'\n"
        : `compare: invalid argument for option '-extract': ${options[1]}\n`);
      expect(mode === "buffered" || mode === "sync" ? files.get("diff.ppm") : await filesystem.readFile("/diff.ppm")).toEqual(original);
    });
  }
}
