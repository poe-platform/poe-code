import { posixPath } from "@poe-code/safe-fs/runtime-core";
import { hostCwd } from "#experiment-platform";
export const path = { ...posixPath, resolve: (...parts: string[]): string => posixPath.resolve(hostCwd(), ...parts) };
