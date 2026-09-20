import { expect, test, vi } from "vitest";

const provider = vi.hoisted(() => ({
	acquire: vi.fn(),
	close: vi.fn(),
}));
vi.mock("@cloudflare/playwright", () => ({
	acquire: provider.acquire,
	connect: async () => ({
		newContext: async () => ({
			newPage: async () => ({ setContent: async () => {} }),
			addCookies: async () => {},
		}),
		close: provider.close,
	}),
}));
vi.mock("../src/browser-run-code", () => ({ createBrowserRunCode: () => {} }));
vi.mock("../src/browser-run-code-native", () => ({ captureRunCodeState: () => ({}) }));
vi.mock("./browser-storage-route.test.worker-cases", () => ({ handleBrowserStorageScenario: async () => undefined }));
import worker from "./browser-run-code.test.worker";

test("native response boundary includes acquisition failures", async () => {
	provider.acquire.mockRejectedValueOnce(new Error("Acquisition failed"));
	const response = await worker.fetch(new Request("http://localhost/unknown"), {} as never);
	expect(response.status).toBe(500);
	expect(await response.json()).toMatchObject({ error: "Error: Acquisition failed" });
});

test("native response boundary includes scenario and retirement failures", async () => {
	provider.acquire.mockResolvedValueOnce({ sessionId: "owned" });
	provider.close.mockRejectedValueOnce(new Error("Transport closure failed"));
	const binding = { fetch: async () => new Response(null, { status: 200 }) };
	const response = await worker.fetch(new Request("http://localhost/unknown"), { BROWSER: binding } as never);
	expect(response.status).toBe(500);
	const result = await response.json() as { error: string };
	expect(result.error).toContain("Unknown native scenario");
	expect(result.error).toContain("Transport closure failed");
});
