import { buildHuffmanTable, type HuffmanTable } from "./jpeg-decode-kernel.js";
/** JPEG table ids are four-bit fields; both input drivers share admission. */
export class JpegTables {
  readonly quantTables: Uint16Array[] = [];
  readonly dcTrees: HuffmanTable[] = [];
  readonly acTrees: HuffmanTable[] = [];
  restartInterval = 0;
  read(marker: number, payload: Uint8Array): boolean {
    if (marker === 0xdb) {
      // DQT
      let qPos = 0;
      while (qPos < payload.length) {
        const info = payload[qPos++]!;
        const precision = info >>> 4;
        const qId = info & 0x0f;
        const table = new Uint16Array(64);
        for (let i = 0; i < 64; i++) {
          table[i] =
            precision === 0 ? payload[qPos++]! : (payload[qPos++]! << 8) | payload[qPos++]!;
        }
        this.quantTables[qId] = table;
      }
    } else if (marker === 0xc4) {
      // DHT
      let hPos = 0;
      while (hPos < payload.length) {
        const info = payload[hPos++]!;
        const tableClass = info >>> 4;
        const hId = info & 0x0f;
        const counts = payload.subarray(hPos, hPos + 16);
        hPos += 16;
        let totalSymbols = 0;
        for (let i = 0; i < 16; i++) totalSymbols += counts[i]!;
        const symbols = payload.subarray(hPos, hPos + totalSymbols);
        hPos += totalSymbols;
        const tree = buildHuffmanTable(counts, symbols);
        if (tableClass === 0) this.dcTrees[hId] = tree;
        else this.acTrees[hId] = tree;
      }
    } else if (marker === 0xdd && payload.length >= 2) {
      // DRI
      this.restartInterval = (payload[0]! << 8) | payload[1]!;
    } else return false;
    return true;
  }
}
