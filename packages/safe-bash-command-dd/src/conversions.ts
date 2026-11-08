import type { DdPlan } from "./options.js";
import type { DdStatistics } from "./report.js";

const encodings = {
  ascii: "000102039c09867f978d8e0b0c0d0e0f101112139d8508871819928f1c1d1e1f" +
    "80818283840a171b88898a8b8c050607909116939495960498999a9b14159e1a" +
    "20a0a1a2a3a4a5a6a7a8d52e3c282b7c26a9aaabacadaeafb0b121242a293b7e" +
    "2d2fb2b3b4b5b6b7b8b9cb2c255f3e3fbabbbcbdbebfc0c1c2603a2340273d22" +
    "c3616263646566676869c4c5c6c7c8c9ca6a6b6c6d6e6f7071725ecccdcecfd0" +
    "d1e5737475767778797ad2d3d45bd6d7d8d9dadbdcdddedfe0e1e2e3e45de6e7" +
    "7b414243444546474849e8e9eaebeced7d4a4b4c4d4e4f505152eeeff0f1f2f3" +
    "5c9f535455565758595af4f5f6f7f8f930313233343536373839fafbfcfdfeff",
  ebcdic: "00010203372d2e2f1605250b0c0d0e0f101112133c3d322618193f271c1d1e1f" +
    "405a7f7b5b6c507d4d5d5c4e6b604b61f0f1f2f3f4f5f6f7f8f97a5e4c7e6e6f" +
    "7cc1c2c3c4c5c6c7c8c9d1d2d3d4d5d6d7d8d9e2e3e4e5e6e7e8e9ade0bd9a6d" +
    "79818283848586878889919293949596979899a2a3a4a5a6a7a8a9c04fd05f07" +
    "202122232415061728292a2b2c090a1b30311a333435360838393a3b04143ee1" +
    "4142434445464748495152535455565758596263646566676869707172737475" +
    "767778808a8b8c8d8e8f906a9b9c9d9e9fa0aaabac4aaeafb0b1b2b3b4b5b6b7" +
    "b8b9babbbca1bebfcacbcccdcecfdadbdcdddedfeaebecedeeeffafbfcfdfeff",
  ibm: "00010203372d2e2f1605250b0c0d0e0f101112133c3d322618193f271c1d1e1f" +
    "405a7f7b5b6c507d4d5d5c4e6b604b61f0f1f2f3f4f5f6f7f8f97a5e4c7e6e6f" +
    "7cc1c2c3c4c5c6c7c8c9d1d2d3d4d5d6d7d8d9e2e3e4e5e6e7e8e9ade0bd5f6d" +
    "79818283848586878889919293949596979899a2a3a4a5a6a7a8a9c04fd0a107" +
    "202122232415061728292a2b2c090a1b30311a333435360838393a3b04143ee1" +
    "4142434445464748495152535455565758596263646566676869707172737475" +
    "767778808a8b8c8d8e8f909a9b9c9d9e9fa0aaabacadaeafb0b1b2b3b4b5b6b7" +
    "b8b9babbbcbdbebfcacbcccdcecfdadbdcdddedfeaebecedeeeffafbfcfdfeff",
};

export class DdConverter {
  private readonly table = Uint8Array.from({ length: 256 }, (_, index) => index);
  private readonly newline: number;
  private readonly space: number;
  private saved: number | undefined;
  private column = 0;
  private spaces = 0;
  private readonly buffer: Uint8Array;
  private used = 0;

  constructor(private readonly plan: DdPlan, private readonly stats: DdStatistics, private readonly emit: (bytes: Uint8Array) => Promise<void>, chunkSize: number) {
    const translate = (name: keyof typeof encodings, byte: number): number => Number.parseInt(encodings[name].slice(byte * 2, byte * 2 + 2), 16);
    for (let index = 0; index < 256; index++) {
      let value = plan.convert.has("ascii") ? translate("ascii", index) : index;
      if (plan.convert.has("lcase") && value >= 65 && value <= 90) value += 32;
      if (plan.convert.has("ucase") && value >= 97 && value <= 122) value -= 32;
      if (plan.convert.has("ebcdic")) value = translate("ebcdic", value);
      if (plan.convert.has("ibm")) value = translate("ibm", value);
      this.table[index] = value;
    }
    this.newline = plan.convert.has("ebcdic") || plan.convert.has("ibm") ? 37 : 10;
    this.space = plan.convert.has("ebcdic") || plan.convert.has("ibm") ? 64 : 32;
    this.buffer = new Uint8Array(chunkSize);
  }

  private async output(byte: number): Promise<void> {
    this.buffer[this.used++] = byte;
    if (this.used === this.buffer.length) {
      await this.emit(this.buffer);
      this.used = 0;
    }
  }

  private async record(byte: number): Promise<void> {
    const width = Number(this.plan.cbs);
    if (this.plan.convert.has("block")) {
      if (byte === this.newline) {
        while (this.column < width) { await this.output(this.space); this.column++; }
        this.column = 0;
      } else {
        if (this.column < width) await this.output(byte);
        else if (this.column === width) this.stats.truncated++;
        this.column = Math.min(width + 1, this.column + 1);
      }
    } else if (this.plan.convert.has("unblock")) {
      if (this.column === width) { await this.output(this.newline); this.column = 0; this.spaces = 0; }
      this.column++;
      if (byte === this.space) this.spaces++;
      else {
        while (this.spaces > 0) { await this.output(this.space); this.spaces--; }
        await this.output(byte);
      }
    } else await this.output(byte);
  }

  async push(input: Uint8Array): Promise<void> {
    if (!["swab", "block", "unblock"].some(conversion => this.plan.convert.has(conversion))) {
      for (let offset = 0; offset < input.length; offset += this.buffer.length) {
        const count = Math.min(this.buffer.length, input.length - offset);
        for (let index = 0; index < count; index++) this.buffer[index] = this.table[input[offset + index]!]!;
        await this.emit(this.buffer.subarray(0, count));
      }
      return;
    }
    for (const byte of input) {
      const value = this.table[byte]!;
      if (this.plan.convert.has("swab")) {
        if (this.saved === undefined) this.saved = value;
        else { await this.record(value); await this.record(this.saved); this.saved = undefined; }
      } else await this.record(value);
    }
    if (this.used) { await this.emit(this.buffer.subarray(0, this.used)); this.used = 0; }
  }

  async finish(): Promise<void> {
    if (this.saved !== undefined) { await this.record(this.saved); this.saved = undefined; }
    if (this.plan.convert.has("block") && this.column > 0) {
      while (this.column < Number(this.plan.cbs)) { await this.output(this.space); this.column++; }
    }
    if (this.plan.convert.has("unblock") && this.column) await this.output(this.newline);
    if (this.used) { await this.emit(this.buffer.subarray(0, this.used)); this.used = 0; }
  }
}
