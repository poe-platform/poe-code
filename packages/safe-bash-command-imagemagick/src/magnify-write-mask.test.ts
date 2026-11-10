import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runConvertCliSync } from "./index.js";

const colors = ["ef4020", "2266ee", "17df90"];
const input = Buffer.concat([Buffer.from("P6\n3 3\n255\n"), Buffer.from([0, 1, 1, 0, 0, 1, 2, 0, 0].map(i => colors[i]).join(""), "hex")]);
const mask = Buffer.concat([Buffer.from("P5\n3 3\n255\n"), Buffer.from([0, 255, 0, 255, 0, 255, 0, 255, 0])]);
const edit = ["-channel", "R", "-evaluate", "set", "100%", "+channel"];
// Native ImageMagick 7.1.2-35 Q16-HDRI RGB8 references.
for (const selection of [
    { name: "write-mask", args: ["-write-mask", "/mask.pgm"], clear: "+write-mask", originalHash: "a15ec01042608a852cb3c146498c6df591402e15ba0fd8e4c6027409c45ee1db" },
    { name: "region", args: ["-region", "2x1+0+0"], clear: "+region", originalHash: "7a853ae19214e40829197d552de2026b1acb477e81f0dede6d0441aa5010a346" },
]) {
    const cases = [
        { name: "edit after magnify", operations: ["-magnify", ...edit], length: 108, hash: "277c7abae9272447f5802932938a097df172414b81be56ba0f959f676b6e0a5a" },
        { name: "magnify only", operations: ["-magnify"], length: 108, hash: "4080a94abf579579217bb84591caac4f9a93b1c0108d908944a174b6024a088a" },
        { name: "clear before edit", operations: ["-magnify", selection.clear, ...edit], length: 108, hash: "277c7abae9272447f5802932938a097df172414b81be56ba0f959f676b6e0a5a" },
        { name: "edit without magnify", operations: edit, length: 27, hash: selection.originalHash },
    ];
    for (const mode of ["command", "retained", "buffered", "sync"] as const) {
        it.each(cases)(`${mode}: ${selection.name} $name`, async ({ operations, length, hash }) => {
            const files = new Map([["/in.ppm", input], ["/mask.pgm", mask], ["/out", Buffer.from("KEEP")]]);
            const filesystem = new MemoryFileSystem();
            for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
            const args = ["/in.ppm", ...selection.args, ...operations, "-depth", "8", "rgb:/out"];
            let stdout = "", stderr = "";
            const argumentValues = createCommandArguments(args);
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } },
            }) : mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result, stderr).toMatchObject({ exitCode: 0 });
            expect("stdout" in result ? result.stdout : stdout).toBe("");
            expect("stderr" in result ? result.stderr : stderr).toBe("");
            const output = mode === "command" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
            expect(output).toHaveLength(length);
            expect(createHash("sha256").update(output).digest("hex")).toBe(hash);
        });
    }
}
