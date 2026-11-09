import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick keeps only the first input's comment and label in either direction.
const properties = [
  { comment: "FirstNote", label: "FirstLabel", asset: "FirstAsset" },
  { comment: "SecondNote", label: "SecondLabel" },
  undefined,
];
const inputs = properties.map((properties, index) => encodeImage({
  width: 1, height: 1, data: Uint8Array.of(index === 0 ? 255 : 0, 0, index === 1 ? 255 : 0, 255),
  format: "png", space: "srgb", channels: 3, depth: "uchar", density: 72, hasAlpha: false, ...(properties ? { properties } : {}),
}, { format: "png" }).data);

for (const mode of ["sync", "map", "filesystem", "command"] as const) {
  for (const direction of ["+append", "-append"]) {
    it.each([[0, 1], [1, 0], [2, 0], [0]])(
      `${mode} ${direction} preserves the first properties for inputs %j`, async (...order) => {
        const files = new Map(inputs.map((input, index) => [`/${index}.png`, input]));
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const argumentValues = createCommandArguments([...order.map(index => `/${index}.png`), direction, "/out.png"]);
        let stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
          command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
          signal: new AbortController().signal, stdin: (async function* () {})(),
          stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runMagickCliSync(argumentValues.args, files)
          : await runMagickCli(argumentValues.args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "sync" || mode === "map" ? files.get("/out.png")! : await fs.readFile("/out.png"));
        expect(output.properties?.comment).toBe(properties[order[0]!]?.comment);
        expect(output.properties?.label).toBe(properties[order[0]!]?.label);
        expect(output.properties?.asset).toBe(properties[order[0]!]?.asset);
        expect([output.width, output.height]).toEqual(direction === "+append" ? [order.length, 1] : [1, order.length]);
        expect([...output.data]).toEqual(order.flatMap(index => [...decodeImage(inputs[index]!).data]));
      },
    );
  }
}
