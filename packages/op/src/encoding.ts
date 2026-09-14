import { TextDecoder, createTextEncoder } from "@kayahr/text-encoding/no-encodings";
import "@kayahr/text-encoding/encodings/shift_jis";
import "@kayahr/text-encoding/encodings/gbk";

export function createOpTextCodec(value: unknown) {
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
    decoder: (options?: TextDecoderOptions) => new TextDecoder(encoding, options),
  };
}
