import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/core";
import {createCommandArguments} from "safe-bash-contracts/command";
import {decodeImage, readImageMetadata} from "@poe-code/image-ast";
import {createMagickCommand} from "./index.js";

// ImageMagick consumes the plain sample delimiter, then the remainder of a line.
for (const magic of ["P2", "P3", "P5"]) for (const separator of ["", "\n", "\n\n"]) {
  const pages = (magic === "P5" ? separator === "" : separator === "\n\n") ? 2 : 1;
  it(`${magic} with ${separator.length} boundary newlines writes ${pages} MIFF frames`, async () => {
    const frame = (value: number) => Buffer.concat([
      Buffer.from(`${magic}\n1 1\n255\n`),
      magic === "P5" ? Buffer.from([value]) : Buffer.from(Array(magic === "P3" ? 3 : 1).fill(value).join(" "))
    ]);
    const input = Buffer.concat([frame(68), Buffer.from(separator), frame(153), Buffer.from("\n")]);
    expect(readImageMetadata(input).pages ?? 1).toBe(pages);
    if (pages === 1) expect(() => decodeImage(input, {page: 1})).toThrow("page out of range");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.pnm", input);
    await fs.writeFile("/out.miff", Buffer.from("keep"));
    const args = createCommandArguments(["input.pnm", "out.miff"]);
    let stderr = "";
    const result = await createMagickCommand().execute({
      command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
      signal: new AbortController().signal, stdin: (async function* () {})(),
      stdout: {async write() {}}, stderr: {async write(bytes) {stderr += new TextDecoder().decode(bytes);}}
    });
    expect(stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = Buffer.from(await fs.readFile("/out.miff"));
    const starts: number[] = [];
    for (let offset = 0; (offset = output.indexOf("id=ImageMagick", offset)) !== -1; offset++) starts.push(offset);
    expect(starts).toHaveLength(pages);
    for (let page = 0; page < pages; page++) {
      const value = page === 0 ? 68 : 153;
      expect(Array.from(decodeImage(output.subarray(starts[page], starts[page + 1])).data)).toEqual([value, value, value, 255]);
    }
  });
}
