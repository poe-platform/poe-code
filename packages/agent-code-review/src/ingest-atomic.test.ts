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

async function withObjectPrototypeProperties<T>(
  properties: Record<string, unknown>,
  callback: () => Promise<T> | T
): Promise<T> {
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries(properties)) {
    originals.set(key, Object.getOwnPropertyDescriptor(Object.prototype, key));
    Object.defineProperty(Object.prototype, key, {
      configurable: true,
      value,
      writable: true
    });
  }

  try {
    return await callback();
  } finally {
    for (const [key, descriptor] of originals) {
      if (descriptor === undefined) {
        delete (Object.prototype as Record<string, unknown>)[key];
      } else {
        Object.defineProperty(Object.prototype, key, descriptor);
      }
    }
  }
}

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

  it("does not ignore stale legacy output directories with inherited missing-file codes", async () => {
    randomUUID.mockReturnValue("safe");
    vol.mkdirSync("/repo/.poe-code/code-review/ingest/security/generated-profile.md", {
      recursive: true
    });
    const spawnAgent = vi.fn(async () => ({
      exitCode: 0,
      signal: null,
      stdout: "",
      stderr: ""
    }));

    await withObjectPrototypeProperties({ code: "ENOENT" }, async () => {
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
            loadPrompt: async () => "Synthesize profile",
            spawnAgent
          }
        )
      ).rejects.toThrow("Code-review ingest path is not a regular file");
    });
    expect(spawnAgent).not.toHaveBeenCalled();
  });
});
