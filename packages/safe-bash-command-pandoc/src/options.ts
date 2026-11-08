import type {CiteprocFilterOptions} from "./citeproc-filters.js";
import type {PandocCommandsOptions} from "./command.js";

/** Validate registration without evaluating the document engines. */
export function validatePandocOptions(options: PandocCommandsOptions): void {
  if (options.replace !== undefined && typeof options.replace !== "boolean") throw new TypeError("pandoc replace must be boolean");
  const interpreter = options.jsonFilterCommand;
  if (interpreter !== undefined && (typeof interpreter !== "string" || !interpreter || [...interpreter].some(character => character.trim() === "" || character === "/" || character === "\0")))
    throw new TypeError("pandoc jsonFilterCommand must be a registered command name");
  if (interpreter !== undefined && options.filters !== undefined) throw new TypeError("Supply either filters or jsonFilterCommand");
  validateCiteprocOptions(options.citeproc === undefined ? {} : options.citeproc);
}

export function validateCiteprocOptions(options: CiteprocFilterOptions): void {
  if (!options || typeof options !== "object" ||
      (options.style !== undefined && typeof options.style !== "string") ||
      (options.locale !== undefined && typeof options.locale !== "string") ||
      (options.references !== undefined && !Array.isArray(options.references)))
    throw new TypeError("CSL style, locale and references must be valid when supplied");
}
