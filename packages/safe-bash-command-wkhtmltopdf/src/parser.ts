import { WkhtmltopdfError } from "./errors.js";
import { ParseBudget, type ParseOptions } from "./limits.js";
import { clonePageSettings, createGlobalSettings, createPageSettings, type GlobalSettings, type PageSettings } from "./settings.js";
import { switches } from "./switches.js";

export interface DocumentObject {
  readonly kind: "page" | "cover" | "toc";
  readonly input: string | null;
  readonly settings: PageSettings;
}
export interface ParsedInvocation {
  readonly mode: "conversion" | "batch" | "information";
  readonly global: GlobalSettings;
  readonly pageDefaults: PageSettings;
  readonly objects: readonly DocumentObject[];
  readonly output: string | null;
}

const longOptions = new Map(switches.map(entry => [entry.name, entry]));
const shortOptions = new Map(switches.filter(entry => entry.short).map(entry => [entry.short, entry]));

/** Literal Unicode SDK argv, excluding argv[0]. No execution or resource acquisition. */
export function parseInvocation(argv: readonly string[], options: ParseOptions): ParsedInvocation {
  const budget = new ParseBudget(options);
  budget.admitArguments(argv.length);
  for (const arg of argv) budget.admitText(arg);
  budget.step(64);
  const global = createGlobalSettings();
  const defaults = createPageSettings();
  const objects: DocumentObject[] = [];
  let index = 0;
  let literal = false;

  const parseOptions = (settings: PageSettings, scope: "leading" | "page" | "toc") => {
    if (literal) return;
    while (index < (scope === "leading" ? argv.length : argv.length - 1)) {
      const token = argv[index]!;
      if (!token.startsWith("-") || token === "-") break;
      budget.step();
      if (token === "--" && options.endOfOptions) {
        index++;
        literal = true;
        break;
      }
      if (token === "--" || token.startsWith("--0")) {
        throw new WkhtmltopdfError("UNQUALIFIED_QUIRK", "Pinned default-mode sentinel is unqualified and not admitted", token);
      }
      index++;
      const names = token.startsWith("--") ? [token] : token.slice(1);
      for (const name of names) {
        budget.step();
        const entry = token.startsWith("--") ? longOptions.get(name) : shortOptions.get(name);
        if (!entry) throw new WkhtmltopdfError("UNKNOWN_OPTION", "Unknown switch", token);
        const allowed = entry.scope === "page" || (entry.scope === "global" ? scope === "leading" : scope === "toc");
        if (!allowed) throw new WkhtmltopdfError("OPTION_LOCATION", "Switch is in an incorrect object scope", entry.name);
        if (entry.arity > argv.length - index) {
          throw new WkhtmltopdfError("MISSING_OPERAND", "Switch is missing an operand", entry.name);
        }
        if (entry.disposition !== "static") {
          throw new WkhtmltopdfError("UNSUPPORTED_CAPABILITY", `Switch requires unavailable ${entry.disposition} capability`, entry.name);
        }
        budget.step(entry.arity + 1);
        const operands = argv.slice(index, index + entry.arity);
        index += entry.arity;
        try { entry.apply!(global, settings, operands); }
        catch (error) {
          if (error instanceof WkhtmltopdfError) throw new WkhtmltopdfError(error.code, error.message, entry.name);
          throw error;
        }
        if (global.action) return;
      }
    }
  };

  parseOptions(defaults, "leading");
  if (global.action) return { mode: "information", global, pageDefaults: defaults, objects, output: null };
  if (global.readArgsFromStdin && !options.batchJob) return { mode: "batch", global, pageDefaults: defaults, objects, output: null };
  while (index < argv.length - 1) {
    budget.admitObject(defaults.replacements.length);
    const settings = clonePageSettings(defaults);
    let kind: DocumentObject["kind"] = "page";
    const token = argv[index++]!;
    let input: string | null = token;
    if (token === "toc") { kind = "toc"; input = null; }
    else if (token === "cover" || token === "page") {
      kind = token;
      if (index >= argv.length - 1) {
        throw new WkhtmltopdfError("MISSING_OBJECT", "Object requires an input and a final output");
      }
      input = argv[index++]!;
    }
    parseOptions(settings, kind === "toc" ? "toc" : "page");
    if (kind === "cover") {
      for (const furniture of [settings.header, settings.footer]) {
        furniture.left = furniture.right = furniture.center = furniture.htmlUrl = "";
        furniture.line = false;
      }
      settings.includeInOutline = false;
    }
    objects.push({ kind, input, settings });
  }
  if (!objects.length || index !== argv.length - 1) {
    throw new WkhtmltopdfError("MISSING_OBJECT", "Expected at least one input object and exactly one output");
  }
  const margins = [global.marginTop, global.marginBottom, global.marginLeft, global.marginRight];
  if (margins.some(margin => margin.unit !== global.marginLeft.unit)) {
    throw new WkhtmltopdfError("MARGIN_UNITS", "All margins must use the same normalized unit");
  }
  return { mode: "conversion", global, pageDefaults: defaults, objects, output: argv[index]! };
}

/** Pinned batch state tokenizer; no shell evaluation, expansion or quote errors. */
export function tokenizeBatchLine(line: string, options: ParseOptions): readonly string[] {
  const budget = new ParseBudget(options);
  budget.admitText(line);
  const tokens: string[] = [];
  let token = "";
  let quote = "";
  let escaped = false;
  const emit = () => {
    if (!token) return;
    budget.admitArguments(tokens.length + 1);
    tokens.push(token);
    token = "";
  };
  for (const character of line) {
    budget.step();
    if (escaped) { token += character; escaped = false; }
    else if (character === "\\") escaped = true;
    else if (quote) {
      if (character === quote) quote = "";
      else token += character;
    } else if (character === "'" || character === '"') quote = character;
    else if (" \t\r\n".includes(character)) emit();
    else token += character;
  }
  emit();
  return tokens;
}
