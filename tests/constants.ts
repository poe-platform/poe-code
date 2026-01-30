import {
  DEFAULT_TEXT_MODEL,
  DEFAULT_IMAGE_BOT,
  DEFAULT_VIDEO_BOT,
  DEFAULT_AUDIO_BOT
} from "../src/cli/constants.js";

export const TEST_MODELS = {
  text: DEFAULT_TEXT_MODEL,
  image: DEFAULT_IMAGE_BOT,
  video: DEFAULT_VIDEO_BOT,
  audio: DEFAULT_AUDIO_BOT
} as const;

export const TEST_PROMPTS = {
  simple: "What is 2+2?",
  image: "A red square on white background",
  video: "Ocean waves",
  audio: "Hello world"
} as const;
