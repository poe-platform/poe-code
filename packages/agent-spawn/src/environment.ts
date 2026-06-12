export type SpawnEnvironment = Record<string, string | undefined>;

export function mergeSpawnEnvironment(
  ...sources: Array<SpawnEnvironment | NodeJS.ProcessEnv | undefined>
): Record<string, string> {
  const merged: Record<string, string> = Object.create(null) as Record<string, string>;

  for (const source of sources) {
    for (const [key, value] of Object.entries(source ?? {})) {
      if (value === undefined) {
        delete merged[key];
      } else {
        merged[key] = value;
      }
    }
  }

  return merged;
}
