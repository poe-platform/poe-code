import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// PNG fixtures and decoded RGB hashes verified with ImageMagick 7.1.2-35 and Pillow.
const fixtures = {
  "plain.png": "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAHElEQVR4nGPgi2pss/G4zGbIKBClEHLn3nulFAA+bAcMunzgaQAAAABJRU5ErkJggg==",
  "text.png": "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFXRFWHRDb21tZW50AG9yaWdpbmFsIG5vdGULKp6kAAAAE3RFWHRBdXRob3IAdGVzdCBmaXh0dXJlzp5mdgAAABxJREFUeJxj4ItqbLPxuMxmyCgQpRBy5957pRQAPmwHDLp84GkAAAAASUVORK5CYII=",
  "edit.png": "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAHElEQVR4nGPgi2pss/G4zGbIKBCloPTeQpGfCwA4HQUMR2wSSwAAAABJRU5ErkJggg==",
};
const cases = [
  { first: "text.png", second: "plain.png", tagged: true, different: false },
  { first: "text.png", second: "edit.png", tagged: true, different: true },
  { first: "plain.png", second: "text.png", tagged: false, different: false },
  { first: "plain.png", second: "edit.png", tagged: false, different: true },
];

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
  it.each(cases)(`${mode} compare carries only the first input's PNG properties: $first $second`, async ({ first, second, tagged, different }) => {
    const files = new Map(Object.entries(fixtures).map(([name, bytes]) => [name, Buffer.from(bytes, "base64")]));
    const fs = new MemoryFileSystem();
    for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
    const args = ["-metric", "RMSE", first, second, "diff.png"];
    let stderr = "";
    const command = mode === "magick" ? createMagickCommand() : createCompareCommand();
    const result = mode === "compare" || mode === "magick" ? await command.execute({
      command: command.name, args: createCommandArguments([...(mode === "magick" ? ["compare"] : []), ...args]).args,
      cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
      stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runCompareCliSync(args, files)
      : await runCompareCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(different ? 1 : 0);
    expect(("stderr" in result ? result.stderr as string : stderr).trim()).toBe(different ? "10564.6 (0.161206)" : "0 (0)");
    const output = mode === "sync" || mode === "buffered" ? files.get("diff.png")! : await fs.readFile("/diff.png");
    const image = decodeImage(output);
    expect(createHash("sha256").update(image.data.filter((_, i) => i % 4 !== 3)).digest("hex")).toBe(different
      ? "3179cf1d5f4f8fe9c97e0f0888df68c7b1b0053c75d26e72ec71684da7e2c833"
      : "121afb7ec34a92c7c8371d413e1ace40090fb15ebba6f5b42546d8dae2ffecca");
    expect(image.properties?.Author).toBe(tagged ? "test fixture" : undefined);
    expect(image.properties?.Comment).toBe(tagged ? "original note" : undefined);
  });
}
