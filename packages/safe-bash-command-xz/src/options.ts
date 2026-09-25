import { createOptionsParser, formats } from "safe-bash-compression-engine/options";

export const xzProfile = { ...formats.xz, format: "xz", names: ["xz", "unxz", "xzcat"] } as const;
export const parseOptions = createOptionsParser([xzProfile]);
