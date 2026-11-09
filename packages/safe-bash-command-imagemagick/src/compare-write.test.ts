import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
  for (const equal of [false, true]) {
    for (const position of ["first", "second"] as const) {
    it(`${mode} compare writes the current operand without consuming it (equal=${equal}, operand=${position})`, async () => {
      const samples = [20, 100, 210, 60, 160, 230];
      const other = [20, 100, 210, 60, 140, 230];
      const pgm = (values: number[]) => Uint8Array.from([...new TextEncoder().encode("P5\n3 2\n255\n"), ...values]);
      const files = new Map([["body.pgm", pgm(samples)], ["other.pgm", pgm(other)],
        ["snapshot.pgm", new TextEncoder().encode("KEEP")], ["diff.pgm", new TextEncoder().encode("KEEP")]]);
      const filesystem = new MemoryFileSystem();
      for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
      const first = equal ? "other.pgm" : "body.pgm";
      const args = ["-metric", "RMSE", ...(position === "first"
        ? ["(", first, "-write", "snapshot.pgm", ")", "other.pgm"]
        : [first, "(", "other.pgm", "-write", "snapshot.pgm", ")"]), "diff.pgm"];
      let result;
      if (mode === "compare" || mode === "magick") {
        const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
        const argumentValues = createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]);
        let stdout = "", stderr = "";
        result = { ...await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
          cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
          stdin: (async function* () {})(),
          stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
          stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr };
      } else result = mode === "sync" ? runCompareCliSync(args, files)
        : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      expect({ ...result, stderr: result.stderr.trim() }).toEqual({ exitCode: equal ? 0 : 1, stdout: "", stderr: equal ? "0 (0)" : "2098.4 (0.0320195)" });
      for (const [path, expected] of [["snapshot.pgm", equal || position === "second" ? other : samples],
        ["diff.pgm", [208, 224, 246, 216, equal ? 232 : 56, 250]]] as const) {
        const image = decodeImage(mode === "sync" || mode === "buffered" ? files.get(path)! : await filesystem.readFile(`/${path}`));
        expect([image.width, image.height]).toEqual([3, 2]);
        expect([...image.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
      }
    });
    }
  }
}

for (const retained of [false, true]) {
  it(`publishes snapshots when the diff is discarded (retained=${retained})`, async () => {
    const input = Uint8Array.from([...new TextEncoder().encode("P5\n1 1\n65535\n"), 0x12, 0x34]);
    const files = new Map([["input.pgm", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.pgm", input);
    const result = await runCompareCli(["(", "input.pgm", "-write", "snapshot.png", ")", "snapshot.png", "null:"],
      retained ? { filesystem, cwd: "/" } : files);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
    const snapshot = decodeImage(retained ? await filesystem.readFile("/snapshot.png") : files.get("snapshot.png")!);
    expect([...snapshot.data16!]).toEqual([0x1234, 0x1234, 0x1234, 65535]);
  });

  it(`rejects -write without a destination (retained=${retained})`, async () => {
    expect(await runCompareCli(["xc:red", "xc:red", "-write"], retained
      ? { filesystem: new MemoryFileSystem(), cwd: "/" } : new Map())).toEqual({
        exitCode: 2, stdout: "", stderr: "compare: missing an argument for option '-write'\n"
      });
  });
}

for (const mode of ["sync", "buffered", "retained"] as const) {
  for (const output of ["diff.pgm", "null:"]) {
    it(`${mode} returns snapshot bytes on stdout with diff ${output}`, async () => {
      const input = Uint8Array.from([...new TextEncoder().encode("P5\n1 1\n255\n"), 37]);
      const files = new Map([["input.pgm", input]]);
      const filesystem = new MemoryFileSystem();
      await filesystem.writeFile("/input.pgm", input);
      const args = ["(", "input.pgm", "-write", "pgm:-", ")", "input.pgm", output];
      const result = mode === "sync" ? runCompareCliSync(args, files)
        : await runCompareCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
      expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "0 (0)" });
      expect([...decodeImage(result.stdoutBytes!).data]).toEqual([37, 37, 37, 255]);
    });
  }
}
