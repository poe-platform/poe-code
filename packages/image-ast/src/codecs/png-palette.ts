/** Exact opaque colors only: never quantize pixels to select a smaller PNG. */
export class PngPalette {
  private readonly colors = new Map<number, number>();

  add(pixels: Uint8Array): boolean {
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] !== 255) return false;
      const color = pixels[i]! * 65536 + pixels[i + 1]! * 256 + pixels[i + 2]!;
      if (!this.colors.has(color)) {
        if (this.colors.size === 256) return false;
        this.colors.set(color, this.colors.size);
      }
    }
    return true;
  }

  get depth(): number {
    return this.colors.size <= 2 ? 1 : this.colors.size <= 4 ? 2 : this.colors.size <= 16 ? 4 : 8;
  }

  get bytes(): Uint8Array {
    return Uint8Array.from([...this.colors.keys()].flatMap(color => [color >>> 16, (color >>> 8) & 255, color & 255]));
  }

  pack(pixels: Uint8Array): Uint8Array {
    const depth = this.depth;
    const packed = new Uint8Array(Math.ceil(pixels.length / 4 * depth / 8));
    for (let i = 0; i < pixels.length; i += 4) {
      const color = pixels[i]! * 65536 + pixels[i + 1]! * 256 + pixels[i + 2]!;
      const bit = i / 4 * depth;
      packed[bit >>> 3] = packed[bit >>> 3]! | (this.colors.get(color)! << (8 - depth - bit % 8));
    }
    return packed;
  }
}
