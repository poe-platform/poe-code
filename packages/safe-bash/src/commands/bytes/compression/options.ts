import { createOptionsParser, profiles as sharedProfiles } from "safe-bash-compression-engine/options";
import { xzProfile } from "safe-bash-command-xz/options";
export type { CompressionOptions, CompressionFormat, ZstdOptions } from "safe-bash-compression-engine/options";

export const profiles = [...sharedProfiles.slice(0, 2), xzProfile, ...sharedProfiles.slice(2)];
export const parseOptions = createOptionsParser(profiles);
