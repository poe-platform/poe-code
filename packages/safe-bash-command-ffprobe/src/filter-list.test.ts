import { describe, expect, it } from "vitest";
import { formatIntrospectionOutput } from "./media.js";

describe("ffmpeg -filters", () => {
  it.each(["drawtext", "subtitles"])("lists %s as a video-to-video filter", (name) => {
    const output = formatIntrospectionOutput("-filters", []);
    const entry = output.split("\n").map(line => line.trim().split(" ").filter(Boolean))
      .find(([filter]) => filter === name);
    expect(entry?.[1]).toBe("V->V");
  });
});
