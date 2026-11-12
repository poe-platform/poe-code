import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, createMontageCommand, runMontageCli, runMontageCliSync } from "./index.js";

const sourceRow = "1e506e285a78326482a0968cb4aaa0b9afa5c8beb4";
const sharpenedRow = "1c4e6c285a781b5b82b89e8abdb0a4b8aea3ccc2b8";
const input = Buffer.concat([Buffer.from("P6\n7 3\n255\n"), Buffer.from(sourceRow.repeat(3), "hex")]);
// Complete PPM digests and pixels from ImageMagick 7.1.2-35 Q16-HDRI.
const cases = [
    { name: "filtered source", inputs: ["/in.ppm", "-adaptive-sharpen", "0x1"], rows: sharpenedRow.repeat(3), height: 3, digest: "0854f3ba549a5277f194df25cc1b1cb8c04190b616c1c81e3ea24fc8f21609f0" },
    { name: "grouped filtered and untouched sources", inputs: ["(", "/in.ppm", "-adaptive-sharpen", "0x1", ")", "/in.ppm"], rows: sharpenedRow.repeat(3) + sourceRow.repeat(3), height: 6, digest: "1e2e34cf3920e1426aa598145d30504392b4a39143cd9a3cf4b22f1663bc0a2e" },
    { name: "untouched control", inputs: ["/in.ppm"], rows: sourceRow.repeat(3), height: 3, digest: "c20d9afda814f6be7e9aaa18abb4ef9c4f53066ef74c13d31ce1034b68af3d7e" },
];

for (const mode of ["command", "montage", "sync", "buffered", "retained"] as const)
it.each(cases)(`matches native montage $name (${mode})`, async ({ inputs, rows, height, digest }) => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = [...inputs, "-tile", "1x", "-geometry", "+0+0", "-depth", "8", "ppm:-"];
    const chunks: Uint8Array[] = [];
    let stderr = "";
    const files = new Map([["/in.ppm", input]]);
    const command = mode === "montage" ? createMontageCommand() : createMagickCommand();
    const result = mode === "command" || mode === "montage" ? await command.execute({
        command: command.name, args: createCommandArguments(mode === "montage" ? args : ["montage", ...args]).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write(bytes) { chunks.push(bytes.slice()); } },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
    }) : mode === "sync" ? runMontageCliSync(args, files)
        : await runMontageCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    expect(result.exitCode).toBe(0);
    const output = "stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array ? result.stdoutBytes : Buffer.concat(chunks);
    const image = decodeImage(output);
    expect([image.width, image.height]).toEqual([7, height]);
    expect(Buffer.from(image.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(rows);
    expect(createHash("sha256").update(output).digest("hex")).toBe(digest);
});

it.each(["bad", "", "2x1junk", "5000x1"])("preserves an existing output when adaptive geometry %j is invalid", async geometry => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const previous = new TextEncoder().encode("keep this output");
    await fs.writeFile("/out.ppm", previous);
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(["montage", "/in.ppm", "-adaptive-sharpen", geometry, "/out.ppm"]).args,
        cwd: "/", env: {}, fs, signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} },
    });
    expect(result.exitCode).not.toBe(0);
    expect(await fs.readFile("/out.ppm")).toEqual(previous);
});
