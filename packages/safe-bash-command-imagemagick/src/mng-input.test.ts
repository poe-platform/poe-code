import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { expect, it } from "vitest";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7: 16x16 red/lime/blue GIF, delays 20/40/20, loop 2,
// converted with `magick input.gif native.mng`. Independent of our MNG writer.
const native = Uint8Array.from(atob("ik1ORw0KGgoAAAAcTUhEUgAAABAAAAAQAAAAZAAAAAAAAAAAAAAAAAAAAAMiL9SdAAAAClRFUk0DAAAAABQAAAACEntk7wAAAAFzUkdCAK7OHOkAAAAKRlJBTQEAAgAAAAAAABQAMVDzAAAADUlIRFIAAAAQAAAAEAEDAAAAJT1tIgAAAANQTFRF/wAAGeIJNwAAAAd0SU1FB+oLBxYGLO0lj0sAAAAMSURBVAjXY2AgDQAAADAAAceqhY4AAAAASUVORK5CYIIAAAAKRlJBTQEAAgAAAAAAACgvXix0AAAADUlIRFIAAAAQAAAAEAEDAAAAJT1tIgAAAANQTFRFAP8ANF7AqAAAAAd0SU1FB+oLBxYGLO0lj0sAAAAMSURBVAjXY2AgDQAAADAAAceqhY4AAAAASUVORK5CYIIAAAAKRlJBTQEAAgAAAAAAABQAMVDzAAAADUlIRFIAAAAQAAAAEAEDAAAAJT1tIgAAAANQTFRFAAD/injSVwAAAAd0SU1FB+oLBxYGLO0lj0sAAAAMSURBVAjXY2AgDQAAADAAAceqhY4AAAAASUVORK5CYIIAAAAATUVORCEg99U="), c => c.charCodeAt(0));

it.each(["sync", "buffered", "retained"] as const)("reads native MNG frames, timing and loop (%s)", async mode => {
    const files = new Map([["in.mng", native]]);
    const fs = new MemoryFileSystem();
    await fs.writeFile("/in.mng", native);
    for (const input of ["in.mng", "MNG:in.mng", "in.mng[1]"]) {
        const args = [input, "out.gif"];
        const result = mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, mode === "buffered" ? files : { filesystem: fs, cwd: "/" });
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const bytes = mode === "retained" ? await fs.readFile("/out.gif") : files.get("out.gif")!;
        const decoded = decodeImage(bytes, { animated: true });
        const selected = input.endsWith("[1]");
        expect([decoded.width, decoded.height]).toEqual([16, selected ? 16 : 48]);
        expect(decoded.delay).toEqual(selected ? [400] : [200, 400, 400]);
        expect(decoded.loop).toBe(2);
        const colors = Array.from({ length: selected ? 1 : 3 }, (_, i) => [...decoded.data.slice(i * 16 * 16 * 4, i * 16 * 16 * 4 + 4)]);
        expect(colors).toEqual(selected ? [[0, 255, 0, 255]] : [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]]);
    }
});
