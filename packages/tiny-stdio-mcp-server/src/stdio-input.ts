import { Transform, type TransformCallback } from "node:stream";

export class StdioInput extends Transform {
  private lineBytes = 0;
  private trailingHighSurrogate = false;

  constructor(private readonly maxLineBytes: number) {
    super({ decodeStrings: false, readableObjectMode: true });
  }

  override _transform(chunk: Buffer | string, _encoding: BufferEncoding, callback: TransformCallback): void {
    const text = typeof chunk === "string";
    if (!text) this.trailingHighSurrogate = false;
    let start = 0;
    for (let index = 0; index < chunk.length; index++) {
      const unit = text ? chunk.charCodeAt(index) : chunk[index]!;
      if (unit === 10 || unit === 13) {
        this.lineBytes = 0;
        this.trailingHighSurrogate = false;
        this.push(text ? chunk.slice(start, index + 1) : chunk.subarray(start, index + 1));
        start = index + 1;
        if (this.destroyed) { callback(); return; }
        continue;
      }
      if (text) {
        const lowSurrogate = unit >= 0xdc00 && unit <= 0xdfff;
        this.lineBytes += this.trailingHighSurrogate && lowSurrogate ? 1 : unit <= 0x7f ? 1 : unit <= 0x7ff ? 2 : 3;
        this.trailingHighSurrogate = unit >= 0xd800 && unit <= 0xdbff;
      } else {
        this.lineBytes++;
      }
      if (this.lineBytes > this.maxLineBytes) {
        callback(new Error("Stdio input line byte limit exceeded"));
        return;
      }
    }
    if (start < chunk.length) this.push(text ? chunk.slice(start) : chunk.subarray(start));
    callback();
  }
}
