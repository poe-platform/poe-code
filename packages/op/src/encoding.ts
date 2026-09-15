import { TextDecoder, createTextEncoder } from "./encoding-runtime.js";

export interface OpTextCodec {
  encode(input?: string): Uint8Array<ArrayBuffer>;
  decoder(options?: { fatal?: boolean; ignoreBOM?: boolean }): {
    readonly encoding: string;
    readonly fatal: boolean;
    readonly ignoreBOM: boolean;
    decode(input?: ArrayBufferLike | ArrayBufferView, options?: { stream?: boolean }): string;
  };
}

export function createOpTextCodec(value: unknown): OpTextCodec {
  const aliases: Readonly<Record<string, string>> = {
    "": "utf-8", shift_jis: "shift_jis", "shift-jis": "shift_jis",
    shiftjis: "shift_jis", sjis: "shift_jis", gbk: "gbk",
  };
  const label = value === undefined ? "" : typeof value === "string" ? value.toLowerCase() : undefined;
  if (label === undefined || !Object.hasOwn(aliases, label)) throw new Error("unsupported character-encoding");
  const encoding = aliases[label]!;
  const encoder = createTextEncoder(encoding);
  return {
    encode: encoder.encode.bind(encoder),
    decoder: (options) => new TextDecoder(encoding, options),
  };
}
