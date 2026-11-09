import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {createMagickCommand} from "./index.js";

for (const magic of ["P2", "P5"]) for (const overRange of [false, true]) {
  it(`writes saturated ${magic} pixels to MIFF, overRange=${overRange}`, async () => {
    const samples = overRange ? [0, 16, 255] : [0, 8, 15];
    const input = Buffer.concat([Buffer.from(`${magic}\n3 1\n15\n`), magic === "P2" ? Buffer.from(samples.join(" ") + "\n") : Buffer.from(samples)]);
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
    // Native ImageMagick renders the over-range fixture as 00 ff ff.
    expect([...output.subarray(end + 4)]).toEqual(overRange ? [0, 255, 255] : [0, 136, 255]);
  });
}
