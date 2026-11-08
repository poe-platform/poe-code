import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { writeHumanPromptJsonl } from "./jsonl.js";

describe("writeHumanPromptJsonl", () => {
  it("writes prompt records as JSONL", async () => {
    const fs = createFsFromVolume(new Volume()).promises;

    await writeHumanPromptJsonl(
      [
        {
          traceId: "one",
          source: "codex",
          cwd: "/repo",
          timestamp: "2026-06-13T12:00:00.000Z",
          text: "Did you test it?"
        }
      ],
      "/tmp/prompts/human-prompts.jsonl",
      fs
    );

    await expect(fs.readFile("/tmp/prompts/human-prompts.jsonl", "utf8")).resolves.toBe(
      '{"traceId":"one","source":"codex","cwd":"/repo","timestamp":"2026-06-13T12:00:00.000Z","text":"Did you test it?"}\n'
    );
  });
});
