import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createCompareCommand, createMagickCommand, runCompareCli, runCompareCliSync } from "./index.js";

// Identical PNG bytes compared with native ImageMagick 7.1.2-35 Q16-HDRI.
const plain = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAHElEQVR4nGPgi2pss/G4zGbIKBClEHLn3nulFAA+bAcMunzgaQAAAABJRU5ErkJggg==";
const edit = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAHElEQVR4nGPgi2pss/G4zGbIKBCloPTeQpGfCwA4HQUMR2wSSwAAAABJRU5ErkJggg==";
const text = "iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFXRFWHRDb21tZW50AG9yaWdpbmFsIG5vdGULKp6kAAAAE3RFWHRBdXRob3IAdGVzdCBmaXh0dXJlzp5mdgAAABxJREFUeJxj4ItqbLPxuMxmyCgQpRBy5957pRQAPmwHDLp84GkAAAAASUVORK5CYII=";

for (const mode of ["sync", "buffered", "retained", "compare", "magick"] as const) {
  async function run(args: string[]) {
    const files = new Map<string, Uint8Array>([["plain.png", Buffer.from(plain, "base64")], ["edit.png", Buffer.from(edit, "base64")],
      ["text.png", Buffer.from(text, "base64")], ["diff.png", Buffer.from("KEEP")]]);
    const filesystem = new MemoryFileSystem();
    for (const [path, bytes] of files) await filesystem.writeFile(`/${path}`, bytes);
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
    const output = mode === "sync" || mode === "buffered" ? files.get("diff.png")! : await filesystem.readFile("/diff.png");
    return { result: { ...result, stderr: result.stderr.trim() }, output };
  }

  for (const [args, properties] of [
    [["-set", "comment", "new note", "plain.png", "edit.png"], { comment: "new note" }],
    [["-set", "label", "review", "plain.png", "edit.png"], { label: "review" }],
    [["text.png", "-set", "comment", "replacement", "edit.png"], { Author: "test fixture", comment: "replacement" }]
  ] as const) {
    it(`${mode} compare sets PNG properties: ${args.join(" ")}`, async () => {
      const { result, output } = await run(["-metric", "RMSE", ...args, "diff.png"]);
      expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "10564.6 (0.161206)" });
      const image = decodeImage(output);
      expect(image.properties).toEqual(properties);
      expect(image.icc).toBeUndefined();
      expect([image.width, image.height]).toEqual([3, 2]);
      const rgb = image.data.filter((_, index) => index % 4 !== 3);
      expect(createHash("sha256").update(rgb).digest("hex")).toBe("3179cf1d5f4f8fe9c97e0f0888df68c7b1b0053c75d26e72ec71684da7e2c833");
    });
  }

  it(`${mode} compare expands properties and replaces repeated keys on identical inputs`, async () => {
    const { result, output } = await run(["-metric", "RMSE", "text.png", "plain.png",
      "-set", "comment", "first", "-set", "comment", "size=%wx%h", "-set", "label", "%[comment]", "diff.png"]);
    expect(result).toEqual({ exitCode: 0, stdout: "", stderr: "0 (0)" });
    expect(decodeImage(output).properties).toEqual({ Author: "test fixture", comment: "size=3x2", label: "size=3x2" });
  });

  it(`${mode} compare leaves the reference metadata intact when only the candidate is labeled`, async () => {
    const { result, output } = await run(["-metric", "RMSE", "plain.png", "(", "edit.png", "-set", "label", "candidate", ")", "diff.png"]);
    expect(result).toEqual({ exitCode: 1, stdout: "", stderr: "10564.6 (0.161206)" });
    expect(decodeImage(output).properties ?? {}).toEqual({});
  });

  it.each([["-set"], ["-set", "comment"]])(`${mode} compare rejects incomplete property arguments %j without replacing output`, async (...options) => {
    const { result, output } = await run(["plain.png", "edit.png", "diff.png", ...options]);
    expect(result).toEqual({ exitCode: 2, stdout: "", stderr: "compare: missing an argument for option '-set'" });
    expect(new TextDecoder().decode(output)).toBe("KEEP");
  });
}
