import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAkAAAAHCAYAAADam2dgAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6NDU6MzYrMDA6MDDZwku5AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjQ1OjM2KzAwOjAwqJ/zBQAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTo0NTozNiswMDowMP+K0toAAACXSURBVBjTXcohD0FhGMXxd49iNkEQTLMbXaYYm0i4URUkX0H2HUTfwURFd6OhsQmCs4nslv9myr3buzedc57nV3LduTtc30k8uX+t0Us/ldbw+Mh2g9OrU41Gl189HpukJbCXJIA8Z5LOxba8tAEXwJqkJoB5jyeQBDCVtDDvgKQNsA7gyiRtAzgFbj40oC8pC2AZiIr9B68y0SJ6hpAJAAAAAElFTkSuQmCC", "base64");

for (const mode of ["buffered", "retained", "command"])
for (const operation of ["encode", "blur", "reveal", "red"])
it(`matches native hidden RGB after zero-degree rotational blur (${mode}, ${operation})`, async () => {
    const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    const args = ["in.png", ...(operation === "red" ? ["-channel", "R"] : []),
        ...(operation === "encode" ? [] : ["-rotational-blur", "0"]),
        ...(operation === "reveal" ? ["-alpha", "off"] : []), "PNG32:out.png"];
    if (mode === "command") {
        const command = createMagickCommand(), argumentValues = createCommandArguments(args);
        const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
            cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
        expect(result.exitCode).toBe(0);
    } else {
        const result = await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" });
        expect(result.exitCode, result.stderr).toBe(0);
    }
    // ImageMagick 7.1.2-35 Q16-HDRI clears hidden RGB at all 14 transparent pixels.
    // Plain PNG32 encoding and all 49 nontransparent pixels retain their RGB.
    const expected = decodeImage(input).data.slice();
    let transparent = 0;
    for (let i = 0; i < expected.length; i += 4) {
        if (expected[i + 3] === 0) {
            transparent++;
            if (operation !== "encode") expected.fill(0, i, i + (operation === "red" ? 1 : 3));
        }
        if (operation === "reveal") expected[i + 3] = 255;
    }
    expect(transparent).toBe(14);
    const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([9, 7]);
    expect(output.data).toEqual(expected);
});
