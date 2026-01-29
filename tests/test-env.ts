export const TEST_ENV = {
  POE_TEXT_MODEL: "Claude-Haiku-4.5",
  POE_IMAGE_MODEL: "nano-banana-pro",
  POE_VIDEO_MODEL: "veo-3.1",
  POE_AUDIO_MODEL: "ElevenLabs-v3",
  POE_SNAPSHOT_MODE: "playback",
  POE_SNAPSHOT_DIR: "__snapshots__",
  POE_SNAPSHOT_MISS: "error"
} as const;

export function loadTestEnv(): void {
  for (const [key, value] of Object.entries(TEST_ENV)) {
    if (typeof process.env[key] === "undefined") {
      process.env[key] = value;
    }
  }
}
