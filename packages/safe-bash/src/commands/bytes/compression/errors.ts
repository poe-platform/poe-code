import { PublicDiagnostic } from "../../../diagnostics.js";

const dataErrors = new Set([
  "incorrect header check", "unknown compression method", "invalid window size",
  "unknown header flags set", "header crc mismatch", "invalid block type",
  "invalid stored block lengths", "too many length or distance symbols",
  "invalid code lengths set", "invalid bit length repeat", "invalid code -- missing end-of-block",
  "invalid literal/lengths set", "invalid distances set", "invalid literal/length code",
  "invalid distance code", "invalid distance too far back", "incorrect data check", "incorrect length check",
]);

export function compressionDiagnostic(error: unknown): unknown {
  if (!(error instanceof Error) || error instanceof PublicDiagnostic) return error;
  const code: unknown = "code" in error ? error.code : undefined;
  if ((code === "Z_DATA_ERROR" && dataErrors.has(error.message)) || (code === "Z_BUF_ERROR" && error.message === "unexpected end of file")) {
    return new PublicDiagnostic(error.message);
  }
  return error;
}
