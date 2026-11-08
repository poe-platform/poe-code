export { fileTypeFromBuffer, type FileTypeResult } from "./file-type.js";

export function parseContentType(value: string | null): { mimeType?: string; charset?: string } {
  if (!value) {
    return {};
  }

  const [rawMimeType, ...parameters] = value.split(";");
  const mimeType = rawMimeType?.trim().toLowerCase();
  const charsetParameter = parameters.find((parameter) =>
    parameter.trim().toLowerCase().startsWith("charset=")
  );
  const rawCharset = charsetParameter?.split("=", 2)[1]?.trim();
  const charset = rawCharset?.startsWith('"') && rawCharset.endsWith('"')
    ? rawCharset.slice(1, -1)
    : rawCharset;
  return {
    ...(mimeType ? { mimeType } : {}),
    ...(charset ? { charset } : {})
  };
}

export function assertBase64(value: string): void {
  if (value.length % 4 !== 0) {
    throw new Error("Invalid base64 content");
  }

  let paddingStarted = false;
  let paddingCount = 0;
  for (const character of value) {
    if (character === "=") {
      paddingStarted = true;
      paddingCount += 1;
      continue;
    }
    const code = character.charCodeAt(0);
    const isValid =
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      (code >= 48 && code <= 57) ||
      character === "+" ||
      character === "/";
    if (!isValid || paddingStarted) {
      throw new Error("Invalid base64 content");
    }
  }
  if (paddingCount > 2) {
    throw new Error("Invalid base64 content");
  }
}

export function safeRemoteLabel(url: string): string {
  try {
    const parsed = new URL(url);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return "remote resource";
  }
}
