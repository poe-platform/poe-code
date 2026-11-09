import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createMagickCommand} from "./index.js";

for (const magic of ["P2", "P5"]) for (const maxval of [0, 15]) {
  it(`validates ${magic} maxval=${maxval} before replacing MIFF output`, async () => {
    const samples = [1, 2, 3];
    const input = Buffer.concat([Buffer.from(`${magic}\n3 1\n${maxval}\n`), magic === "P2" ? Buffer.from(samples.join(" ") + "\n") : Buffer.from(samples)]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.pgm", input);
    await fs.writeFile("/out.miff", Buffer.from("keep"));
    const args = createCommandArguments(["input.pgm", "out.miff"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
      command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
    });
    if (maxval === 0) {
      expect(result.exitCode).toBe(1);
      expect(stderr).toContain("Invalid Netpbm maxval");
      expect(Buffer.from(await fs.readFile("/out.miff")).toString()).toBe("keep");
      return;
    }
    expect(result.exitCode).toBe(0);
    expect(stderr).toBe("");
    const output = Buffer.from(await fs.readFile("/out.miff"));
    const end = output.indexOf(Buffer.from([12, 10, 58, 26]));
    expect(end).toBeGreaterThan(0);
    const header = output.subarray(0, end).toString();
    expect(header).toContain("class=DirectClass");
    expect(header).toContain("colorspace=Gray");
    expect(header).toContain("depth=8");
    expect(header).toContain("compression=None");
    expect([...output.subarray(end + 4)]).toEqual([17, 34, 51]);
  });
}
