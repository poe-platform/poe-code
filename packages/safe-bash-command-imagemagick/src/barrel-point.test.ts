import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli } from "./index.js";

const input = Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABMAAAAPCAIAAACJJmN7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMDk6NTk6NTgrMDA6MDBAybJ6AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDA5OjU5OjU4KzAwOjAwMZQKxgAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QwOTo1OTo1OCswMDowMGaBKxkAAAA5SURBVCjPY2RgEOFlYuBlYuBleg1jiBIjwsLEz8DERA6iSOdrGEcUxiBKZIBcS5oj4SKjYTu8whYAfS4XOob+v0EAAAAASUVORK5CYII=", "base64"));
// ImageMagick 7.1.2-35 Q16-HDRI: input.png -filter point -distort Barrel '0.45 0 0 0.55' out.png.
const native = decodeImage(Uint8Array.from(Buffer.from("iVBORw0KGgoAAAANSUhEUgAAABMAAAAPCAIAAACJJmN7AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcKABph+edAAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDA5OjU5OjU4KzAwOjAwQMmyegAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QwOTo1OTo1OCswMDowMDGUCsYAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTA6MDA6MjYrMDA6MDCrozVLAAACjUlEQVQoz12SP4hUZxTFz7n3fu/vvDfuursoTBBUCAgSuyRNBJVgkcImEIesqaIgyILY2QTBVpAlgqRRDLNJKlNoREyKpEjWTlKEpEiTgLCTCCOz6+y8931finFD4uXCvcXvwDlwCCwAAJATPbe+pPvn9eCuZFQlcx39rUNUAXVYnFcs6bDn7uf8aMYbdqZWVOX+snpS5KM03e3smOk9QR3joRD602awtX36+XQt31G8vGmN7tzNsvqqKEKaDp2D2TciZ0ggIoTj3v/UtNcm2/CTZR3fAWAsIV3U3atlfS4vkKRDl8AMKiMRkCAQ43oIr7X+02n74aTZV28hjGDWuy5lv6yQF5fT7LBLYPZUdUPkL+E7ZAtsAhsBP4Zw1IcLjX/P6mGoBqZ7+syQFQ+S7H3nDpidFh2KjCknyetkJKfgGPg64mGIRzzmJYJV33TpY7HHLj1jyQ21T0QfzUyKBLJHAgQJ8CG4GonIIeVd8ftMF+4qoG5eDCIvRMBZvJ2V2SMJBBTAQOcUd00XTtE/hjwjAeb/o19qZhamohCDJrC0ETtluvRZnCDGBxHnEQ8AJ4ghOCaF/FMYKVORsegLtbPmjrjsdSt+ZQbTPYOw2ffNyeCXYziM8B3wlNggfiBXyFZkU3TDbNUlR5NsPSueLVdYKwdmvZUwWmm2rvoGof05eCDsRdxL/CL8XgQqMOu45O00RV6slvXZL7uL1oWxhJaYjC9PJzfb7Ta0X0T/AQMYu8KZDM69maR/5MW1svr80txFrf/TPt/BZNe5Zjr0209Cs4iwm/GY4JZp7exQml4p8rfK6kS3wm2782rjn3vU2e+d8o2g3Rj+lvDIeMMp0gRFMigVla59q/f/5f8BHZ/agP5dv64AAAAASUVORK5CYII=", "base64")));

it.each([false, true].flatMap(retained => ["-distort", "+distort"].map(operator => ({ retained, operator }))))("matches native point filtering for Barrel, $operator retained=$retained", async ({ retained, operator }) => {
    const files = new Map([["/input.png", input]]), filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const backend = retained ? { filesystem, cwd: "/" } : files;
    const result = await runMagickCli(["/input.png", "-filter", "point", operator, "Barrel", "0.45 0 0 0.55", "/out.png"], backend);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
    expect([output.width, output.height]).toEqual([native.width, native.height]);
    expect(output.data).toEqual(native.data);

    // The default filter differs from Point; +filter must restore that default.
    const defaults = [];
    for (const filter of [[], ["-filter", "point", "+filter"]]) {
        const result = await runMagickCli(["/input.png", ...filter, operator, "Barrel", "0.45 0 0 0.55", "/default.png"], backend);
        expect(result.exitCode, result.stderr).toBe(0);
        defaults.push(decodeImage(retained ? await filesystem.readFile("/default.png") : files.get("/default.png")!));
    }
    expect(defaults[0]!.data).toEqual(defaults[1]!.data);
    expect(defaults[0]!.data).not.toEqual(native.data);
    const offset = (6 * native.width + 8) * 4;
    expect([...defaults[0]!.data.slice(offset, offset + 4)]).toEqual([123, 114, 121, 255]);
    expect([...output.data.slice(offset, offset + 4)]).toEqual([123, 114, 125, 255]);
});
