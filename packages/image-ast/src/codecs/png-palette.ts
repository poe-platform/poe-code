import type { RgbaImage } from "../ast.js";

/** Exact colors only: never quantize pixels to select a smaller PNG. */
export class PngPalette {
  private readonly colors = new Map<number, number>();

  constructor(private readonly original?: NonNullable<RgbaImage["pngPalette"]>) {
    if (original) for (let index = 0; index < original.bytes.length / 3; index++) {
      const color = original.bytes[index * 3]! * 65536 + original.bytes[index * 3 + 1]! * 256 + original.bytes[index * 3 + 2]!;
      const key = color * 256 + (original.transparency?.[index] ?? 255);
      if (!this.colors.has(key)) this.colors.set(key, index);
    }
  }

  add(pixels: Uint8Array): boolean {
    for (let i = 0; i < pixels.length; i += 4) {
      const color = (pixels[i]! * 65536 + pixels[i + 1]! * 256 + pixels[i + 2]!) * 256 + pixels[i + 3]!;
      if (!this.colors.has(color)) {
        if (this.original || this.colors.size === 256) return false;
        this.colors.set(color, this.colors.size);
      }
    }
    return true;
  }

  get depth(): number {
    return this.original?.depth ?? (this.colors.size <= 2 ? 1 : this.colors.size <= 4 ? 2 : this.colors.size <= 16 ? 4 : 8);
  }

  get bytes(): Uint8Array {
    return this.original?.bytes ?? Uint8Array.from([...this.colors.keys()].flatMap(color => [color >>> 24, (color >>> 16) & 255, (color >>> 8) & 255]));
  }

  get transparency(): Uint8Array | undefined {
    if (this.original) return this.original.transparency;
    const alpha = Uint8Array.from(this.colors.keys(), color => color & 255);
    let length = alpha.length;
    while (length > 0 && alpha[length - 1] === 255) length--;
    return length ? alpha.subarray(0, length) : undefined;
  }

  pack(pixels: Uint8Array, indices?: Uint8Array): Uint8Array {
    const depth = this.depth;
    const packed = new Uint8Array(Math.ceil(pixels.length / 4 * depth / 8));
    for (let i = 0; i < pixels.length; i += 4) {
      const color = (pixels[i]! * 65536 + pixels[i + 1]! * 256 + pixels[i + 2]!) * 256 + pixels[i + 3]!;
      let index = this.colors.get(color)!;
      const previous = indices?.[i / 4];
      if (this.original && previous !== undefined && this.original.bytes[previous * 3] === pixels[i] && this.original.bytes[previous * 3 + 1] === pixels[i + 1] && this.original.bytes[previous * 3 + 2] === pixels[i + 2] && (this.original.transparency?.[previous] ?? 255) === pixels[i + 3]) index = previous;
      const bit = i / 4 * depth;
      packed[bit >>> 3] = packed[bit >>> 3]! | (index << (8 - depth - bit % 8));
    }
    return packed;
  }
}
