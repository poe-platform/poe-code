export const TEST_ENV = {
  POE_SNAPSHOT_MODE: "playback",
  POE_SNAPSHOT_MISS: "error"
} as const;

export function loadTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  }
}
