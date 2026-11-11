import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runMogrifyCli } from "./index.js";

const input = Buffer.concat([Buffer.from("P6\n3 2\n255\n"), Buffer.from(Array.from({ length: 18 }, (_, i) => (i * 37 + 19) % 256))]);
const input16 = Buffer.alloc(48 * 2);
for (let i = 0; i < 48; i++) input16.writeUInt16BE((i * 7919 + 211) % 65536, i * 2);
// ImageMagick 7.1.2-35 Q16-HDRI, identical PPM input and complete raw RGB output.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: [], expected: "13385d82a7ccf1163b6085aacff4193e6388" },
        { options: ["-paint", "1"], expected: "13385d13385df1163b6085aa6085aa3e6388" },
        { options: ["-paint", "2x0.5"], expected: "13385d13385df1163b6085aa6085aa3e6388" },
        { options: ["-paint", "0"], expected: "13385d13385df1163b6085aa6085aa3e6388" },
        { options: ["-paint", "x1"], expected: "13385d13385df1163b6085aa6085aa3e6388" },
        { options: ["-set", "option:brush", "1", "-paint", "%[option:brush]"], expected: "13385d13385df1163b6085aa6085aa3e6388" },
        { options: ["-channel", "R", "-paint", "1"], expected: "13385d13a7ccf1163b6085aa60f4193e6388" },
        { options: ["-virtual-pixel", "tile", "-paint", "1"], expected: "3e63886085aacff419f1163b13385d82a7cc" },
        { options: ["-virtual-pixel", "black", "-paint", "1"], expected: "000000000000000000000000000000000000" },
        { options: ["-paint", "1"], highDepth: true, expected: "00d31fc23eb15da000d31fc23eb15da07c8f9b7eba6dd95c740792f6b1e5d0d400d31fc23eb15da000d31fc23eb15da07c8f9b7eba6dd95c740792f6b1e5d0d4deb3fda21c913b80deb3fda21c913b805a6f795e984db73c51e770d68fc5aeb4" },
        { options: ["-paint", "0x1"], highDepth: true, expected: "00d31fc23eb15da000d31fc23eb15da0740792f6b1e5d0d4740792f6b1e5d0d400d31fc23eb15da000d31fc23eb15da0740792f6b1e5d0d4740792f6b1e5d0d4deb3fda21c913b80deb3fda21c913b8051e770d68fc5aeb451e770d68fc5aeb4" },
        { options: ["-paint", "1.1"], highDepth: true, expected: "00d31fc23eb15da000d31fc23eb15da0740792f6b1e5d0d4740792f6b1e5d0d400d31fc23eb15da000d31fc23eb15da0740792f6b1e5d0d4740792f6b1e5d0d4deb3fda21c913b80deb3fda21c913b8051e770d68fc5aeb451e770d68fc5aeb4" },
        { options: ["-channel", "A", "-paint", "1"], highDepth: true, expected: "00d31fc23eb15da07c8f9b7eba6d5da0f84b173a3629d95c740792f6b1e5d0d4efc30eb22da15da06b7f8a6ea95d5da0e73b062a2519d95c62f781e6a0d5d0d4deb3fda21c913b805a6f795e984d3b80d62bf51a1409b73c51e770d68fc5aeb4" },
        { options: ["-channel", "RGB", "-paint", "1"], highDepth: true, expected: "00d31fc23eb15da000d31fc23eb1d95c7c8f9b7eba6d5518740792f6b1e5d0d400d31fc23eb14c9000d31fc23eb1c84c7c8f9b7eba6d4408740792f6b1e5bfc4deb3fda21c913b80deb3fda21c91b73c5a6f795e984d32f851e770d68fc5aeb4" },
        { options: ["-paint", "1", "-paint", "2"], highDepth: true, expected: "00d31fc23eb15da000d31fc23eb15da000d31fc23eb15da0740792f6b1e5d0d400d31fc23eb15da000d31fc23eb15da000d31fc23eb15da0740792f6b1e5d0d4deb3fda21c913b80deb3fda21c913b80deb3fda21c913b8051e770d68fc5aeb4" },
        { options: ["-intensity", "brightness", "-paint", "1"], highDepth: true, expected: "00d31fc23eb15da000d31fc23eb15da062f781e6a0d5bfc462f781e6a0d5bfc400d31fc23eb15da000d31fc23eb15da062f781e6a0d5bfc462f781e6a0d5bfc4deb3fda21c913b80deb3fda21c913b805a6f795e984db73c51e770d68fc5aeb4" },
    ])(`renders oil painting $options (${mode})`, async ({ options, expected, highDepth }) => {
        const args = [...(highDepth ? ["-size", "4x3", "-depth", "16", "rgba:in.ppm"] : ["in.ppm"]), ...options, "-depth", highDepth ? "16" : "8", highDepth ? "rgba:-" : "rgb:-"];
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.ppm", highDepth ? input16 : input);
        const files = new Map([["in.ppm", highDepth ? input16 : input]]);
        const stdout: Uint8Array[] = [];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout.push(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        if ("stderr" in result && typeof result.stderr === "string") stderr = result.stderr;
        if ("stdoutBytes" in result && result.stdoutBytes instanceof Uint8Array) stdout.push(result.stdoutBytes);
        expect(result.exitCode, stderr).toBe(0);
        expect(stderr).toBe("");
        expect(Buffer.concat(stdout).toString("hex")).toBe(expected);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        ["in.ppm", "-paint", "invalid"],
        ["in.ppm", "-paint", "1+2"],
        ["in.ppm", "-paint", "x"],
        ["in.ppm", "-paint", "%"],
        ["in.ppm", "-paint", "5001"],
        ["-paint", "1", "in.ppm"],
        ["in.ppm", "(", "-paint", "1", "in.ppm", ")"],
        ["in.ppm", "+paint", "1"],
    ])(`preserves output on paint errors %j (${mode})`, async (...options) => {
        const filesystem = new MemoryFileSystem();
        const sentinel = new TextEncoder().encode("preserve existing output");
        await filesystem.writeFile("/in.ppm", input);
        await filesystem.writeFile("/out.ppm", sentinel);
        const files = new Map<string, Uint8Array>([["in.ppm", input], ["out.ppm", sentinel]]);
        const args = [...options, "out.ppm"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).not.toBe(0);
        expect(result.stdout).toBe("");
        expect(mode === "retained" ? await filesystem.readFile("/out.ppm") : files.get("out.ppm")).toEqual(sentinel);
    });
}

it("accepts paint geometry in mogrify's in-place option parser", async () => {
    const files = new Map<string, Uint8Array>([["in.ppm", input]]);
    expect(await runMogrifyCli(["-paint", "1", "in.ppm"], files)).toMatchObject({ exitCode: 0, stderr: "" });
    const result = await runMagickCli(["in.ppm", "-depth", "8", "rgb:-"], files);
    expect(Buffer.from(result.stdoutBytes!).toString("hex")).toBe("13385d13385df1163b6085aa6085aa3e6388");
});
