import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Raw RGB references from ImageMagick 7.1.2-35 Q16-HDRI.
for (const mode of ["command", "retained", "map", "sync"] as const)
for (const depth of [8, 16])
for (const inputDepth of [8, 16])
for (const swap of [false, true])
it.each([
    { operation: "Sine", clone: true, rgb8: "fe04a7ae540c", rgb16: "feef0460a750ae8554ae0c7d" },
    { operation: "Sin", clone: true, rgb8: "fe04a7ae540c", rgb16: "feef0460a750ae8554ae0c7d" },
    { operation: "Cosine", clone: true, rgb8: "04dd00fdafff", rgb16: "0398de14001efd91afb0ff98" },
    { operation: "Cos", clone: true, rgb8: "04dd00fdafff", rgb16: "0398de14001efd91afb0ff98" },
    { operation: "Mean", clone: true, rgb8: "0810194a5b6b", rgb16: "0844108818cc4a645aec6b74" },
    { operation: "Sine", clone: false, rgb8: "03e0ae683659", rgb16: "02f7e133ae3c687a360b5932" },
    { operation: "Cosine", clone: false, rgb8: "9bd2f602e806", rgb16: "9b62d347f75a022ee8780606" },
])(`${mode}: $operation with fractional clone=$clone at depth ${depth} (input=${inputDepth}, swap=${swap})`, async ({ operation, clone, rgb8, rgb16 }) => {
    const samples = [10, 20, 30, 90, 110, 130];
    const input = new Uint8Array([...new TextEncoder().encode(`P6\n2 1\n${inputDepth === 16 ? 65535 : 255}\n`),
        ...samples.flatMap(value => inputDepth === 16 ? [value, value] : [value])]);
    const files = new Map([["/in.ppm", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.ppm", input);
    const args = ["/in.ppm", ...(clone ? ["(", "+clone", "-evaluate", "Multiply", "0.47", ")"] : []),
        ...(clone && swap ? ["+swap"] : []), "/in.ppm", "-evaluate-sequence", operation, "-depth", String(depth), "-endian", "MSB", "rgb:/out"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { async write() {} }, stderr: { async write() {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "map" ? files : { filesystem: fs, cwd: "/" });
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "map" || mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
    expect(Buffer.from(output).toString("hex")).toBe(depth === 16 ? rgb16 : rgb8);
});
