import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAABCAIAAAB2XpiaAAAABnRSTlMADAAiADi4ncCAAAAABmJLR0QAWgB4AJbIbmOMAAAACW9GRnMAAAACAAAAAwC8z0QGAAAAEklEQVR4nGPgUbLgUbL8zwACAA1IAc3fKRb3AAAAAElFTkSuQmCC", "base64");

it.each(["buffered", "retained", "sync"] as const)("preserves PNG pixel offsets and raster on a no-op write (%s)", async mode => {
    const files = new Map([["/input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const backend = mode === "retained" ? { filesystem, cwd: "/" } : files;
    const args = ["/input.png", "-format", "%wx%h page=%g offset=%X,%Y", "info:"];
    const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, backend);
    expect(result.exitCode, result.stderr).toBe(0);
    expect(result.stdout.trimEnd()).toBe("4x1 page=4x1+2+3 offset=+2,+3");
    const copyArgs = ["/input.png", "/output.png"];
    const copied = mode === "sync" ? runConvertCliSync(copyArgs, files) : await runConvertCli(copyArgs, backend);
    expect(copied.exitCode, copied.stderr).toBe(0);
    const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
    expect([output.width, output.height]).toEqual([4, 1]);
    expect(output.virtualCanvas).toEqual({ width: 4, height: 1, x: 2, y: 3 });
    expect(output.data).toEqual(decodeImage(input).data);
});
