import type { PlaywrightActionCodeGenerator } from "@poe-platform/safe-bash/playwright";
import { languageSet } from "./browser-codegen.generated.js";

/** Uses the qualified native generators; source strings stay in the CLI renderer. */
export const generateBrowserActionCode: PlaywrightActionCodeGenerator = ({
	language,
	action,
}) => {
	const id = language === "typescript" ? "playwright-test" : language;
	const generator = [...languageSet()].find((candidate) => candidate.id === id);
	if (!generator)
		throw new Error("Unsupported native code generation language");
	const code = generator.generateAction({
		frame: { pageGuid: "page", pageAlias: "page", framePath: [] },
		startTime: 0,
		action: { ...action, signals: [] },
	});
	const lines = code.split("\n");
	const indents = lines
		.filter((line) => line.trim())
		.map((line) => line.length - line.trimStart().length);
	const indent = indents.length ? Math.min(...indents) : 0;
	return lines.map((line) => line.substring(indent)).join("\n");
};
