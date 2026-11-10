interface FontRuntime {
    HEAPU8: Uint8Array;
    HEAP32: Int32Array;
    _malloc(bytes: number): number;
    _free(pointer: number): void;
    _font_open(pointer: number, length: number, size: number, xdpi: number, ydpi: number): number;
    _font_metrics(): number;
    _font_glyph(code: number): number;
    _font_kerning(left: number, right: number): number;
    _font_close(): void;
}
export default function createFontRuntime(): FontRuntime;
