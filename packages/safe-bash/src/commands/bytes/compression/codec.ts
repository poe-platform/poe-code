import { createCompressionCodec } from "@poe-code/office-package/compression";
import { PublicDiagnostic } from "../../../diagnostics.js";
import { readBytes } from "../../../contracts/index.js";
import { yieldTurn } from "../../../contracts/yield.js";
import { compressionDiagnostic } from "./errors.js";

export type { CodecInput } from "@poe-code/office-package/compression";
export const { codec, CodecReader } = createCompressionCodec({
  yieldTurn,
  readBytes,
  diagnostic(error) {
    if (error instanceof Error && error.message === "unexpected end of file") return new PublicDiagnostic(error.message);
    return compressionDiagnostic(error);
  },
});
