import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors = ["ef4020", "2266ee", "17df90"];
const input = Buffer.concat([
    Buffer.from("P6\n3 3\n255\n"),
    Buffer.from([0, 1, 1, 0, 0, 1, 2, 0, 0].map(index => colors[index]).join(""), "hex"),
]);

// ImageMagick 7.1.2-35 Q16-HDRI references for the 3x3 PPM reproduction.
for (const mode of ["command", "buffered", "retained", "sync"] as const) {
    it.each([
        { options: ["-background", "red", "-virtual-pixel", "background"], hash: "a6e87d682d819e730674b5068e142c8332ebc7d7421b5ae9ae532dce66a54d03" },
        { options: ["-virtual-pixel", "tile"], hash: "48d1235dbcd850a998674962f44e9a17929309ad996fd8d1dac03c0e0e3ea7e6" },
        { options: [], hash: "4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a" },
        { options: ["-virtual-pixel", "mirror"], hash: "4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a" },
    ])(`magnify uses native virtual pixels for $options (${mode})`, async ({ options, hash }) => {
        const files = new Map<string, Uint8Array>([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/im.ppm", ...options, "-magnify", "-depth", "8", "rgb:/out"];
        let stdout = "", stderr = "";
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
            stdin: (async function* () {})(), signal: new AbortController().signal,
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
        }) : mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode).toBe(0);
        expect("stdout" in result ? result.stdout : stdout).toBe("");
        expect("stderr" in result ? result.stderr : stderr).toBe("");
        const output = mode === "buffered" || mode === "sync" ? files.get("/out")! : await filesystem.readFile("/out");
        expect(output).toHaveLength(108);
        expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
    });
}
