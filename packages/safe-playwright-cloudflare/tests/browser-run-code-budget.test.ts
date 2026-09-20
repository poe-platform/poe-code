import { expect, test } from "vitest";
import {
	createRunCodeCreationBudget,
	createRunCodeFrameBudget,
	MAX_RUN_CODE_CONTEXTS,
	MAX_RUN_CODE_FRAME_BYTES,
	MAX_RUN_CODE_FRAMES,
} from "../src/browser-run-code-budget";

test("raw CDP creation commands reserve capacity before their responses", () => {
	const budget = createRunCodeCreationBudget({
		maxPages: 2,
		pages: ["parent"],
		contexts: ["owner"],
	});
	budget.command({ id: 1, method: "Target.createTarget" });
	expect(() =>
		budget.command({ id: 2, method: "Target.createTarget" }),
	).toThrow("page limit");
	budget.reply({ id: 1, error: { message: "refused" } });
	budget.command({ id: 3, method: "Target.createTarget" });
	budget.reply({ id: 3, result: { targetId: "child" } });
	expect(() =>
		budget.command({ id: 4, method: "Target.createTarget" }),
	).toThrow("page limit");
	budget.pageDestroyed("child");
	budget.command({ id: 5, method: "Target.createTarget" });
});

test("only successful context disposal releases live capacity", () => {
	const budget = createRunCodeCreationBudget({
		maxPages: 4,
		pages: [],
		contexts: Array.from(
			{ length: MAX_RUN_CODE_CONTEXTS },
			(_, i) => `context-${i}`,
		),
	});
	budget.command({
		id: 1,
		method: "Target.disposeBrowserContext",
		params: { browserContextId: "context-0" },
	});
	expect(() =>
		budget.command({ id: 2, method: "Target.createBrowserContext" }),
	).toThrow("context limit");
	budget.reply({ id: 1, error: { message: "refused" } });
	expect(() =>
		budget.command({ id: 3, method: "Target.createBrowserContext" }),
	).toThrow("context limit");
	budget.command({
		id: 4,
		method: "Target.disposeBrowserContext",
		params: { browserContextId: "context-0" },
	});
	budget.reply({ id: 4, result: {} });
	budget.command({ id: 5, method: "Target.createBrowserContext" });
	budget.reply({ id: 5, result: { browserContextId: "replacement" } });
	expect(() =>
		budget.command({ id: 6, method: "Target.createBrowserContext" }),
	).toThrow("context limit");
});

test("multibyte frame boundaries are measured without an encoded frame allocation", () => {
	const overhead = 8; // {"v":""}
	for (const character of ["界", "😀"]) {
		const width = new TextEncoder().encode(character).byteLength;
		const count = Math.floor((MAX_RUN_CODE_FRAME_BYTES - overhead) / width);
		const prefix = '{"v":"';
		const suffix = '"}';
		const frame = prefix + character.repeat(count) + suffix;
		expect(() => createRunCodeFrameBudget()(frame)).not.toThrow();
		expect(() =>
			createRunCodeFrameBudget()(prefix + character.repeat(count + 1) + suffix),
		).toThrow("frame limit");
	}
	expect(
		createRunCodeFrameBudget()('{"v":"aé界😀\ud800"}').result,
	).toBeUndefined();
});

test("popup events independently enforce the same page bound", () => {
	const budget = createRunCodeCreationBudget({
		maxPages: 1,
		pages: ["parent"],
		contexts: [],
	});
	expect(() => budget.pageCreated("popup")).toThrow("page limit");
});

test("empty contexts and invalid creation IDs cannot bypass reservations", () => {
	const budget = createRunCodeCreationBudget({
		maxPages: 4,
		pages: [],
		contexts: [],
	});
	for (let id = 0; id < 16; id++)
		budget.command({ id, method: "Target.createBrowserContext" });
	expect(() =>
		budget.command({ id: 16, method: "Target.createBrowserContext" }),
	).toThrow("context limit");
	expect(() =>
		budget.command({ id: 0, method: "Target.createBrowserContext" }),
	).toThrow("command ID");
});

test("CDP frames have independent byte and count limits before JSON parsing", () => {
	const count = createRunCodeFrameBudget();
	for (let i = 0; i < MAX_RUN_CODE_FRAMES; i++) count("{}");
	expect(() => count("{}")).toThrow("transport limit");
	expect(() =>
		createRunCodeFrameBudget()("x".repeat(MAX_RUN_CODE_FRAME_BYTES + 1)),
	).toThrow("frame limit");
	expect(() => createRunCodeFrameBudget()(new Uint8Array())).toThrow(
		"frame limit",
	);
	expect(() => createRunCodeFrameBudget()("[]")).toThrow(
		"Invalid run-code CDP",
	);
});
