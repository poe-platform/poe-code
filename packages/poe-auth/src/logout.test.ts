import { beforeEach, describe, expect, it, vi } from "vitest";

const deleteApiKeyMock = vi.hoisted(() => vi.fn<() => Promise<void>>());
const createAuthStoreMock = vi.hoisted(() =>
  vi.fn(() => ({
    backend: "file" as const,
    store: {
      deleteApiKey: deleteApiKeyMock
    }
  }))
);

vi.mock("./create-auth-store.js", () => ({
  createAuthStore: createAuthStoreMock
}));

async function loadLogout() {
  return await import("./logout.js");
}

describe("logout", () => {
  beforeEach(() => {
    vi.resetModules();
    deleteApiKeyMock.mockReset();
    deleteApiKeyMock.mockResolvedValue(undefined);
    createAuthStoreMock.mockClear();
  });

  it("deletes the stored api key", async () => {
    const { logout } = await loadLogout();

    await expect(logout()).resolves.toBeUndefined();

    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(deleteApiKeyMock).toHaveBeenCalledTimes(1);
  });

  it("rethrows store deletion errors", async () => {
    const { logout } = await loadLogout();
    const error = new Error("delete failed");

    deleteApiKeyMock.mockRejectedValue(error);

    await expect(logout()).rejects.toThrow("delete failed");

    expect(createAuthStoreMock).toHaveBeenCalledTimes(1);
    expect(deleteApiKeyMock).toHaveBeenCalledTimes(1);
  });
});
