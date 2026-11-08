import type { MediaProbeSource, MediaProbeText } from "@poe-code/mp4-ast";

export function* packetHexRows(bytes: Uint8Array, offset = 0): Generator<string> {
  for (let start = 0; start < bytes.length; start += 16) {
    const row = bytes.subarray(start, start + 16);
    let hex = "", ascii = "";
    for (let i = 0; i < row.length; i++) {
      hex += row[i]!.toString(16).padStart(2, "0");
      if (i % 2 === 1) hex += " ";
      ascii += row[i]! >= 32 && row[i]! <= 126 ? String.fromCharCode(row[i]!) : ".";
    }
    yield `${(offset + start).toString(16).padStart(8, "0")}: ${hex.padEnd(40, " ")} ${ascii}\n`;
  }
}

export function packetSourceData(source: MediaProbeSource, offset: number, size: number): MediaProbeText {
  return { kind: "text", async *chunks() {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(size) || size < 0 || offset + size > source.size)
      throw new Error("Invalid packet data span");
    yield "\n";
    for (let start = 0; start < size; start += 4096) {
      const length = Math.min(4096, size - start);
      const bytes = await source.read(offset + start, length);
      if (bytes.length !== length) throw new Error("Truncated packet data");
      yield* packetHexRows(bytes, start);
    }
  } };
}
