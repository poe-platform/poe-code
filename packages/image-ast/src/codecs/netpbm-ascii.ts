/** ImageMagick's plain raster layout, retaining at most one pixel between calls. */
export class NetpbmAscii {
  private pixel: string[] = [];
  private pixels = 0;
  private lineLength = 0;
  private wrapped = false;

  constructor(private width: number, private height: number, private channels: number) {}

  sample(value: number): string {
    this.pixel.push(String(value));
    if (this.pixel.length < this.channels) return "";
    const pixel = this.pixel.join(" ");
    this.pixel.length = 0;
    let separator = "";
    if (this.lineLength) {
      if (this.lineLength + pixel.length + 1 < 70) separator = " ";
      else { separator = "\n"; this.lineLength = 0; this.wrapped = true; }
    }
    this.lineLength += pixel.length + (separator === " " ? 1 : 0);
    this.pixels++;
    // After the first wrap, native output carries lines across image rows.
    if ((!this.wrapped && this.pixels % this.width === 0) || this.pixels === this.width * this.height) {
      this.lineLength = 0;
      return separator + pixel + "\n";
    }
    return separator + pixel;
  }
}
