// Keep encoding registration and implementation types out of the public codec declaration.
import "@kayahr/text-encoding/encodings/shift_jis";
import "@kayahr/text-encoding/encodings/gbk";
export { TextDecoder, createTextEncoder } from "@kayahr/text-encoding/no-encodings";
