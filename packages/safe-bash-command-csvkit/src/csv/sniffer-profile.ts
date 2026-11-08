import {decodeSniffUtf8} from "safe-bash-csv-engine/sniffer";
import { CsvkitBlocked } from "../errors.js";

/** Frozen buffer.peek size and decode(errors='ignore') behavior, independent of transport chunks. */
export interface SniffStreamProfile {
  readonly name: string;
  readonly peekBytes: number;
  decode(bytes: Uint8Array, encoding: string, signal: AbortSignal): Promise<string>;
}

export const defaultSniffStreamProfile: SniffStreamProfile = Object.freeze({
  name: "cpython-buffered-65536-utf8-ignore-v1",
  peekBytes: 65536,
  async decode(bytes: Uint8Array, encoding: string, signal: AbortSignal): Promise<string> {
    const name = encoding.toLowerCase().replaceAll("_", "-");
    if (!["utf-8", "utf8", "utf-8-sig"].includes(name))
      throw new CsvkitBlocked(`stdin sniff decode(errors=ignore) profile for ${encoding}`);
    return decodeSniffUtf8(bytes, name === "utf-8-sig", signal);
  }
});
