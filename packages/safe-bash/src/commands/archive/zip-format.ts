import { createZipCodec } from "@poe-code/office-package/zip";
import { yieldTurn } from "../../contracts/yield.js";
import { codec, CodecReader } from "../bytes/compression/codec.js";
import { fail } from "./internal.js";

export { crc32, type ZipEntry, type ZipArchive } from "@poe-code/office-package/zip";
const zip = createZipCodec({
  yieldTurn,
  fail,
  compression: { codec, CodecReader },
}, { utcDates: false });

export const readZipArchive: ReturnType<typeof createZipCodec>["readZipArchive"] = zip.readZipArchive;
export const decodeZipEntry: ReturnType<typeof createZipCodec>["decodeZipEntry"] = zip.decodeZipEntry;
export const makeZipEntry: ReturnType<typeof createZipCodec>["makeZipEntry"] = zip.makeZipEntry;
export const writeZipArchive: ReturnType<typeof createZipCodec>["writeZipArchive"] = zip.writeZipArchive;
