import { createOptionsParser, formats } from "safe-bash-compression-engine/options";

export const xzProfile = { ...formats.xz, format: "xz", names: ["xz", "unxz", "xzcat"] } as const;
export const lzmaProfile = { ...formats.xz, format: "xz", names: ["lzma", "unlzma", "lzcat"] } as const;
const parse = createOptionsParser([xzProfile, lzmaProfile]);

export function parseOptions(command: string, args: readonly string[]) {
  const legacy = lzmaProfile.names.some(name => name === command);
  return parse(command, legacy ? ["--format=lzma", ...args] : args);
}
