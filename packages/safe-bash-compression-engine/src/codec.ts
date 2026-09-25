import { createCompressionCodec } from "@poe-code/office-package/compression";
import { PublicDiagnostic } from "safe-bash-contracts/diagnostics";
import { readBytes } from "safe-bash-contracts";
import { yieldTurn } from "safe-bash-contracts/yield";
import { compressionDiagnostic } from "./errors.js";

export type { CodecInput } from "@poe-code/office-package/compression";
const compression = createCompressionCodec({
  yieldTurn,
  readBytes,
  diagnostic(error) {
    if (error instanceof Error && error.message === "unexpected end of file") return new PublicDiagnostic(error.message);
    return compressionDiagnostic(error);
  },
});

export const codec: ReturnType<typeof createCompressionCodec>["codec"] = compression.codec;
export const CodecReader: ReturnType<typeof createCompressionCodec>["CodecReader"] = compression.CodecReader;
