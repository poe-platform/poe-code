import type { RgbaImage, StoredRgbaImage } from "@poe-code/image-ast/portable";
import type { PagedStorage } from "@poe-code/safe-fs/storage";
import { yieldTurn } from "safe-bash-contracts/yield";

export function ubrlOutput(spec: string): { path: string; cellHeight: number } | undefined {
    const lower = spec.toLowerCase();
    for (const format of ["ubrl", "ubrl6"]) {
        const cellHeight = format === "ubrl6" ? 3 : 4;
        if (lower.startsWith(`${format}:`)) return { path: spec.slice(format.length + 1), cellHeight };
        if (!spec.includes(":") && lower.endsWith(`.${format}`)) return { path: spec, cellHeight };
    }
    return undefined;
}

function header(image: Pick<RgbaImage, "width" | "height" | "properties" | "virtualCanvas">): string {
    const label = image.properties?.label, page = image.virtualCanvas;
    return (label === undefined ? "" : `Title: ${label}\n`)
        + (page?.x ? `X: ${page.x}\n` : "") + (page?.y ? `Y: ${page.y}\n` : "")
        + `Width: ${image.width + image.width % 2}\nHeight: ${image.height}\n\n`;
}

function* cells(data: Uint8Array, width: number, rows: number): Generator<string> {
    const bits = [[0, 3], [1, 4], [2, 5], [6, 7]];
    let text = "";
    for (let x = 0; x < width; x += 2) {
        let cell = 0;
        for (let y = 0; y < rows; y++) for (let dx = 0; dx < 2 && x + dx < width; dx++) {
            // Q16-HDRI's braille writer advances through half of the bilevel cache stride.
            const pixel = Math.ceil((y * width + x + dx) / 2);
            if (data[pixel * 4] === 0) cell |= 1 << bits[y]![dx]!;
        }
        text += String.fromCharCode(0x2800 + cell);
        if (text.length === 512) { yield text; text = ""; }
    }
    yield text + "\n";
}

export function* ubrlText(image: RgbaImage, cellHeight: number): Generator<string> {
    yield header(image);
    for (let y = 0; y < image.height; y += cellHeight) {
        yield* cells(image.data.subarray(y * image.width * 4), image.width, Math.min(cellHeight, image.height - y));
    }
}

export async function* storedUbrlText(image: StoredRgbaImage, storage: PagedStorage, signal: AbortSignal, cellHeight: number): AsyncGenerator<string> {
    yield header(image);
    for (let y = 0; y < image.height; y += cellHeight) {
        await yieldTurn(signal);
        const rows = Math.min(cellHeight, image.height - y);
        const data = await storage.read(image.position + y * image.width * 4, rows * image.width * 4);
        for (const text of cells(data, image.width, rows)) { await yieldTurn(signal); yield text; }
    }
}
