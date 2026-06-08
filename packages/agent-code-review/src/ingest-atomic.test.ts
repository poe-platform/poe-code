import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const randomUUID = vi.hoisted(() => vi.fn<() => string>());

vi.mock("node:crypto", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:crypto")>();
  return { ...actual, randomUUID };
});

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return fs.promises;
});

const { ingestCodeReviewProfile } = await import("./ingest.js");

describe("code review ingest atomic writes", () => {
  beforeEach(() => {
    vol.reset();
    randomUUID.mockReset();
  });

  it("does not remove a colliding ingest artifact temp symlink", async () => {
    randomUUID.mockReturnValue("collision");
    const temporaryPath =
      "/repo/.poe-code/code-review/ingest/security/.comments.jsonl.collision.tmp";
    vol.fromJSON({
      "/outside.tmp": "outside-state\n"
    });
    vol.mkdirSync("/repo/.poe-code/code-review/ingest/security", { recursive: true });
    vol.mkdirSync("/repo/.poe-code/code-review/profiles", { recursive: true });
    vol.symlinkSync("/outside.tmp", temporaryPath);

    await expect(
      ingestCodeReviewProfile(
        {
          username: "alice",
          repos: ["acme/widgets"],
          profile: "security",
          agent: "codex",
          cwd: "/repo"
        },
        {
          fetchHistory: async function* () {},
          loadPrompt: async () => "Synthesize profile"
        }
      )
    ).rejects.toThrow();

    expect(vol.readFileSync("/outside.tmp", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(temporaryPath).isSymbolicLink()).toBe(true);
  });
});
