import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

// Native Q16: raw RGBA 12344567789a8001abcdef015678c003, -channel R/G/B/A -separate -strip.
const planes = [
    "89504e470d0a1a0a0000000d494844520000000200000001100000000081d9fc150000000d4944415408d7631032597d1600030c01bf95bca9270000000049454e44ae426082",
    "89504e470d0a1a0a0000000d494844520000000200000001100000000081d9fc150000000d4944415408d763704d7fcf0800042d019dab56a26a0000000049454e44ae426082",
    "89504e470d0a1a0a0000000d494844520000000200000001100000000081d9fc150000000d4944415408d763ac9875ef1e00065202d0edfd84010000000049454e44ae426082",
    "89504e470d0a1a0a0000000d494844520000000200000001100000000081d9fc150000000d4944415408d7636c6074600200028f00c52b54041a0000000049454e44ae426082"
];

for (const mode of ["buffered", "sync", "retained", "command"])
for (const count of [2, 3, 4])
it(`preserves external 16-bit channel planes (${mode}, planes=${count})`, async () => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const names = planes.slice(0, count).map((_, index) => `/plane${index}.png`);
    for (const [index, name] of names.entries()) {
        const bytes = Buffer.from(planes[index]!, "hex");
        files.set(name, bytes);
        await fs.writeFile(name, bytes);
    }
    const argv = [...names, "-combine", "/out.png"];
    const args = createCommandArguments(argv);
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }
    }) : mode === "sync" ? runConvertCliSync(argv, files)
        : await runConvertCli(argv, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!;
    const expected = [0x1234, 0x4567, (count === 2 ? 0x1234 : 0x789a), count === 4 ? 0x8001 : 65535, 0xabcd, 0xef01, (count === 2 ? 0xabcd : 0x5678), count === 4 ? 0xc003 : 65535];
    const decoded = decodeImage(output);
    expect([decoded.width, decoded.height]).toEqual([2, 1]);
    expect(Array.from(decoded.data16 ?? [])).toEqual(expected);
    const native = spawnSync("magick", ["png:-", "-depth", "16", "-endian", "MSB", "rgba:-"], { input: output });
    if (native.error && "code" in native.error && native.error.code === "ENOENT") return;
    expect(native.status).toBe(0);
    expect(native.stdout.toString("hex")).toBe(expected.map(value => value.toString(16).padStart(4, "0")).join(""));
});
