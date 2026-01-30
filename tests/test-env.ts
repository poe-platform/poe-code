import {
  DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_BOT,
  DEFAULT_VIDEO_BOT,
  DEFAULT_AUDIO_BOT
} from "../src/cli/constants.js";

export const TEST_ENV = {
  POE_TEXT_MODEL: DEFAULT_TEXT_MODEL,
  POE_IMAGE_MODEL: DEFAULT_IMAGE_BOT,
  POE_VIDEO_MODEL: DEFAULT_VIDEO_BOT,
  POE_AUDIO_MODEL: DEFAULT_AUDIO_BOT,
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
