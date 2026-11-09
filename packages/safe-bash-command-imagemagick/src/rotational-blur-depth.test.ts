import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAcAAAADEAYAAAAPU8mGAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRP///////wlY99wAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6MDM6NTYrMDA6MDB2g/WsAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjAzOjU2KzAwOjAwB95NEAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTowMzo1NiswMDowMFDLbM8AAAAtSURBVAjXYxRkcGOoZvj/X5xRnFGckYGBWJpxE/tzdhl2MjQG83Xw7eUjXSMA0V4PbFoZZ8oAAAAASUVORK5CYII=", "base64");
// Native ImageMagick Q16: deep.png -rotational-blur 60 -depth 16 -endian MSB rgba:-.
const blurred = Buffer.from("413c763c7259ffff62cb97cb7775ffff63d0659d9a9dffff56038b03c003ffff556c8a6cbf6cffff5f409440c940ffff8825a0b463ecffff5cb291b2715cffff73b3a8b3885dffffc0614ab67fb6fffff70a2c0a610affff0e0b430b780bffff7a61af618f0cffff9162710d50b8ffff65ef9aef970bffff8ed4c3d4a37fffff98a89a759c42ffff9fbcd4bc09bcffff8a44bf442777ffff8b49c0494a9fffffacd870114fbbffff", "hex");

for (const mode of ["buffered", "retained", "command"])
for (const operation of ["zero", "blur", "alpha"])
it(`preserves the full Q16 rotational blur raster (${mode}, ${operation})`, async () => {
    const files = new Map<string, Uint8Array>([["in.png", input], ["out.png", Buffer.from("keep")]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/in.png", input);
    await filesystem.writeFile("/out.png", Buffer.from("keep"));
    const args = ["in.png", ...(operation === "alpha" ? ["-channel", "A"] : []),
        "-rotational-blur", operation === "zero" ? "0" : "60",
        ...(operation === "alpha" ? ["+channel"] : []), "PNG64:out.png"];
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
    const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
    const expected = operation === "blur"
        ? Uint16Array.from({ length: blurred.length / 2 }, (_, i) => blurred.readUInt16BE(i * 2))
        : decodeImage(input).data16;
    expect([output.width, output.height]).toEqual([7, 3]);
    expect(output.data16).toEqual(expected);
});
