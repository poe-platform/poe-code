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

const { CodeReviewYamlStore } = await import("./review-store.js");

describe("CodeReviewYamlStore atomic writes", () => {
  const directory = "/repo/.poe-code/code-review/reviews";

  beforeEach(() => {
    vol.reset();
    randomUUID.mockReset();
  });

  it("does not remove a colliding draft temp symlink", async () => {
    randomUUID.mockReturnValue("collision");
    const temporaryPath = `${directory}/.acme_widgets_PR123.yaml.collision.tmp`;
    vol.fromJSON({
      "/outside.tmp": "outside-state\n"
    });
    vol.mkdirSync(directory, { recursive: true });
    vol.symlinkSync("/outside.tmp", temporaryPath);

    const store = new CodeReviewYamlStore({ directory });
    await expect(
      store.startRun({
        sessionId: "session-1",
        prUrl: "https://github.com/acme/widgets/pull/123",
        selectedAgent: "codex",
        selectedProfiles: ["security"]
      })
    ).rejects.toThrow();

    expect(vol.readFileSync("/outside.tmp", "utf8")).toBe("outside-state\n");
    expect(vol.lstatSync(temporaryPath).isSymbolicLink()).toBe(true);
  });
});
