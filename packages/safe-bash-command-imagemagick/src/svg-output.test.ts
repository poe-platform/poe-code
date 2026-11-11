import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { parseXmlSteps } from "@poe-code/safe-fs/xml";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

const input = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>');

for (const mode of ["sync", "buffered", "retained", "command"]) {
    it.each(["svg:-", "msvg:-", "MSVG:-", "out.svg", "msvg:out.svg", "rgba:-"])(`${mode} writes %s`, async destination => {
        const args = ["drawing.svg", "-depth", "8", destination];
        const files = new Map([["drawing.svg", input]]), fs = new MemoryFileSystem();
        await fs.writeFile("/drawing.svg", input);
        const chunks: Uint8Array[] = [];
        let stderr = "";
        const result: { exitCode: number; stdout?: string; stdoutBytes?: Uint8Array; stderr?: string } = mode === "sync" ? runMagickCliSync(args, files)
            : mode === "buffered" ? await runMagickCli(args, files)
            : mode === "retained" ? await runMagickCli(args, { filesystem: fs, cwd: "/" })
            : await createMagickCommand().execute({
                command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
                stdin: (async function* () {})(), signal: new AbortController().signal,
                stdout: { async write(chunk) { chunks.push(chunk.slice()); } },
                stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
            });
        expect(result.exitCode).toBe(0);
        expect(result.stderr ?? stderr).toBe("");
        if (result.stdoutBytes) chunks.push(result.stdoutBytes);
        if (result.stdout) chunks.push(new TextEncoder().encode(result.stdout));
        const output = destination.endsWith("out.svg")
            ? mode === "sync" || mode === "buffered" ? files.get("out.svg")! : await fs.readFile("/out.svg")
            : Buffer.concat(chunks);
        if (destination === "rgba:-") {
            expect(Buffer.from(output).toString("hex")).toBe("ff0000ff".repeat(4));
            return;
        }
        expect(new TextDecoder().decode(output).slice(0, 4)).toBe("<svg");
        const parser = parseXmlSteps(new TextDecoder().decode(output));
        let step = parser.next();
        while (!step.done) step = parser.next();
        expect(step.value.name).toBe("svg");
        expect(step.value.namespace).toBe("http://www.w3.org/2000/svg");
        expect(Object.fromEntries(step.value.attributes.map(attribute => [attribute.name, attribute.value]))).toMatchObject({ width: "2", height: "2" });
        const rendered = decodeImage(output);
        expect([rendered.width, rendered.height]).toEqual([2, 2]);
        expect(Buffer.from(rendered.data).toString("hex")).toBe("ff0000ff".repeat(4));
    });
}

it.each([false, true])("preserves alpha and rows across pixel chunks, retained=%s", async retained => {
    const args = ["-size", "1025x2", "xc:rgba(20,40,60,0.5)", "-depth", "8", "-write", "msvg:out.svg", "rgba:-"];
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const result = retained ? await runMagickCli(args, { filesystem: fs, cwd: "/" }) : runMagickCliSync(args, files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = retained ? await fs.readFile("/out.svg") : files.get("out.svg")!;
    const rendered = decodeImage(output);
    expect([rendered.width, rendered.height]).toEqual([1025, 2]);
    expect(rendered.data).toEqual(result.stdoutBytes);
});
