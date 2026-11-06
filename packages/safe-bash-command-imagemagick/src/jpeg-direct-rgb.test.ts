import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createConvertCommand, runConvertCli } from "./index.js";

const jpeg = new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/jpeg-rgb-direct.jpg", import.meta.url)));
const expected = new Uint8Array(readFileSync(new URL("../../pdf-ast/src/fixtures/jpeg-rgb-direct.rgba", import.meta.url)));

it("preserves direct RGB samples through public convert", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.jpg", jpeg);
    const args = createCommandArguments(["/in.jpg", "/out.png"]);
    let stderr = "";
    const result = await createConvertCommand().execute({
        command: "convert", args: args.args, argumentValues: args, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} },
        stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
    });
    expect(result.exitCode, stderr).toBe(0);
    expect(stderr).toBe("");
    const image = decodeImage(await fs.readFile("/out.png"));
    expect([image.width, image.height]).toEqual([17, 13]);
    expect(image.data).toEqual(expected);
});

it("preserves direct RGB samples through buffered convert", async () => {
    const files = new Map([["in.jpg", jpeg]]);
    const result = await runConvertCli(["in.jpg", "out.png"], files);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(decodeImage(files.get("out.png")!).data).toEqual(expected);
});
