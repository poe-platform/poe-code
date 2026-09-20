import type { PlaywrightActionCodeGenerator } from "@poe-platform/safe-bash/playwright";
import { languageSet } from "./browser-codegen.generated.js";

const MAX_ACTION_BYTES = 1024 * 1024;
const MAX_CODE_BYTES = 8 * 1024 * 1024;

/** Uses the qualified native generators; source strings stay in the CLI renderer. */
export const generateBrowserActionCode: PlaywrightActionCodeGenerator = ({
	language,
	action,
}) => {
	const encoder = new TextEncoder();
	if (encoder.encode(JSON.stringify(action)).byteLength > MAX_ACTION_BYTES)
		throw new Error("Playwright code generation input limit exceeded");
	const id = language === "typescript" ? "playwright-test" : language;
	const generator = [...languageSet()].find((candidate) => candidate.id === id);
	if (!generator)
		throw new Error("Unsupported native code generation language");
	const code = generator.generateAction({
		frame: { pageGuid: "page", pageAlias: "page", framePath: [] },
		startTime: 0,
		action: { ...action, signals: [] },
	});
	if (encoder.encode(code).byteLength > MAX_CODE_BYTES)
		throw new Error("Playwright code generation output limit exceeded");
	const lines = code.split("\n");
	const indents = lines
		.filter((line) => line.trim())
		.map((line) => line.length - line.trimStart().length);
	const indent = indents.length ? Math.min(...indents) : 0;
	return lines.map((line) => line.substring(indent)).join("\n");
};
