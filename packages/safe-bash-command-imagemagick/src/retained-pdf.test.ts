import { expect, it } from "vitest";
import { PdfDocument } from "@poe-code/pdf-ast";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runCompareCli, runConvertCli, runIdentifyCli } from "./index.js";

for (const density of ["72", "144"])
for (const operand of ["input.pdf", "input.pdf[-1]", "input.pdf[1,0]"])
    it(`retains PDF ${operand} at density ${density} across image operations`, async () => {
        const document = PdfDocument.create();
        for (const fill of [{ r: 1, g: 0, b: 0 }, { r: 0, g: 1, b: 0 }, { r: 0, g: 0, b: 1 }])
            document.addPage([17, 11]).drawRect({ x: 0, y: 0, width: 17, height: 11, fill });
        const bytes = document.save(), files = new Map([["input.pdf", bytes]]), fs = new MemoryFileSystem();
        await fs.writeFile("/input.pdf", bytes);
        const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file PDF I/O forbidden"); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
        const convert = ["-density", density, operand, "-flip", "out.png"];
        expect(await runConvertCli(convert, { filesystem, cwd: "/" })).toEqual(await runConvertCli(convert, files));
        expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
        const compare = ["-density", density, operand, "input.pdf[0]", "diff.png"];
        expect(await runCompareCli(compare, { filesystem, cwd: "/" })).toEqual(await runCompareCli(compare, files));
        expect(decodeImage(await fs.readFile("/diff.png"))).toEqual(decodeImage(files.get("diff.png")!));
        const identify = ["-format", "%f %m %wx%h %[mean] %[hex:p{2,2}]\n", operand];
        expect(await runIdentifyCli(identify, { filesystem, cwd: "/" })).toEqual(await runIdentifyCli(identify, files));
        expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["diff.png", "input.pdf", "out.png"]);
    });
