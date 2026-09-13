import { createZipCodec } from "@poe-code/office-package/zip";
import { yieldTurn } from "../../contracts/yield.js";
import { codec, CodecReader } from "../bytes/compression/codec.js";
import { fail } from "./internal.js";

export { crc32, type ZipEntry, type ZipArchive } from "@poe-code/office-package/zip";
export const { readZipArchive, decodeZipEntry, makeZipEntry, writeZipArchive } = createZipCodec({
  yieldTurn,
  fail,
  compression: { codec, CodecReader },
}, { utcDates: false });
