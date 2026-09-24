import { settings, type ArchiveLimits } from "./archive/internal.js";

/** Invocation ceilings; command registration may impose tighter limits. */
export interface CommandFamilyLimits {
  readonly archive?: Partial<ArchiveLimits>;
}

export function resolveCommandLimits(...profiles: (CommandFamilyLimits | undefined)[]): CommandFamilyLimits | undefined {
  let archive: Partial<ArchiveLimits> | undefined;
  for (const profile of profiles) {
    if (profile === undefined) continue;
    if (!profile || typeof profile !== "object" || Array.isArray(profile)
      || Object.keys(profile).some(key => key !== "archive")) throw new RangeError("Invalid command-family limits");
    if (profile.archive === undefined) continue;
    if (!profile.archive || typeof profile.archive !== "object" || Array.isArray(profile.archive)) throw new RangeError("Invalid archive limits");
    settings({ limits: profile.archive });
    archive = { ...archive, ...profile.archive };
  }
  return archive === undefined ? undefined : Object.freeze({ archive: Object.freeze(archive) });
}
