import { shellValueByteLength as baseShellValueByteLength, type ShellValue } from "safe-bash-contracts/value";
export * from "safe-bash-contracts/value";

export function shellValueByteLength(value: ShellValue): number {
  if (typeof value !== "string") return baseShellValueByteLength(value);
  let bytes = 0;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 128) bytes += 1;
    else if (code < 2048) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length && value.charCodeAt(i + 1) >= 0xdc00 && value.charCodeAt(i + 1) <= 0xdfff) {
      bytes += 4;
      i++;
    } else {
      bytes += 3;
    }
  }
  return bytes;
}
