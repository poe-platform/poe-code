import { readFile, readdir, mkdir, writeFile, copyFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

function localeRegistration(source, filename, owner) {
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length !== 0 || parsed.statements.length !== 1 || !ts.isIfStatement(parsed.statements[0]))
    throw new TypeError(`Unexpected locale script: ${filename}`);
  const statement = parsed.statements[0].thenStatement;
  if (!ts.isBlock(statement) || statement.statements.length !== 1 || !ts.isExpressionStatement(statement.statements[0]))
    throw new TypeError(`Unexpected locale registration: ${filename}`);
  const call = statement.statements[0].expression;
  if (!ts.isCallExpression(call) || call.expression.getText(parsed) !== `Intl.${owner}.__addLocaleData` || call.arguments.length !== 1)
    throw new TypeError(`Unexpected locale registration: ${filename}`);
  return { parsed, argument: call.arguments[0] };
}

export function extractNumberFormatData(source, filename) {
  const { parsed, argument } = localeRegistration(source, filename, "NumberFormat");
  const value = JSON.parse(argument.getText(parsed));
  if (value === null || typeof value !== "object" || Object.keys(value).length !== 2 ||
      typeof value.locale !== "string" || value.data === null || typeof value.data !== "object" || Array.isArray(value.data) ||
      Intl.getCanonicalLocales(value.locale)[0] !== value.locale)
    throw new TypeError(`Invalid locale data: ${filename}`);
  return value;
}

export function mergeSubsecondUnitData(value, supplemental) {
  const units = supplemental.main?.[value.locale]?.units;
  const extra = {};
  for (const unit of ["microsecond", "nanosecond"]) {
    const patterns = { perUnit: {} };
    for (const style of ["long", "short", "narrow"]) {
      const source = units?.[style]?.[`duration-${unit}`];
      if (source === undefined || typeof source["unitPattern-count-other"] !== "string")
        throw new TypeError(`Missing ${value.locale} ${style} ${unit} patterns.`);
      patterns[style] = {};
      for (const category of ["zero", "one", "two", "few", "many", "other"]) {
        const pattern = source[`unitPattern-count-${category}`];
        if (pattern !== undefined) {
          if (typeof pattern !== "string") throw new TypeError("Invalid unit pattern.");
          patterns[style][category] = pattern;
        }
      }
      if (source.perUnitPattern !== undefined) {
        if (typeof source.perUnitPattern !== "string") throw new TypeError("Invalid per-unit pattern.");
        patterns.perUnit[style] = source.perUnitPattern;
      }
    }
    extra[unit] = patterns;
  }
  return { ...value, data: { ...value.data, units: { ...value.data.units, simple: { ...value.data.units.simple, ...extra } } } };
}

export function extractPluralRulesData(source, filename) {
  const { parsed, argument } = localeRegistration(source, filename, "PluralRules");
  if (!ts.isObjectLiteralExpression(argument)) throw new TypeError("Invalid plural locale record.");
  const locale = argument.properties.find(property => ts.isPropertyAssignment(property) &&
    (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name)) && property.name.text === "locale");
  if (locale === undefined || !ts.isStringLiteral(locale.initializer) || Intl.getCanonicalLocales(locale.initializer.text).length !== 1)
    throw new TypeError("Invalid plural locale name.");
  const check = node => {
    if (ts.isFunctionExpression(node)) return;
    if (ts.isCallExpression(node) || ts.isNewExpression(node) || ts.isSpreadAssignment(node) || ts.isComputedPropertyName(node) || ts.isGetAccessor(node) || ts.isSetAccessor(node))
      throw new TypeError("Executable plural data initializer.");
    ts.forEachChild(node, check);
  };
  check(argument);
  const replacements = [];
  const unwrap = node => ts.isParenthesizedExpression(node) ? unwrap(node.expression) : node;
  const isNumberOperand = node => {
    node = unwrap(node);
    return ts.isIdentifier(node) && node.text === "n" ||
      ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.PercentToken && isNumberOperand(node.left);
  };
  const fixRanges = node => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) {
      const left = unwrap(node.left), right = unwrap(node.right);
      if (ts.isBinaryExpression(left) && ts.isBinaryExpression(right) &&
          left.operatorToken.kind === ts.SyntaxKind.GreaterThanEqualsToken && right.operatorToken.kind === ts.SyntaxKind.LessThanEqualsToken &&
          isNumberOperand(left.left) && left.left.getText(parsed) === right.left.getText(parsed)) {
        // CLDR a..b relations enumerate integers; the published functions omit
        // this guard for n, incorrectly admitting values such as Arabic 3.14.
        replacements.push({ start: node.getStart(parsed), end: node.end, text: `Number.isInteger(n) && (${node.getText(parsed)})` });
        return;
      }
    }
    ts.forEachChild(node, fixRanges);
  };
  fixRanges(argument);
  let expression = argument.getText(parsed);
  const start = argument.getStart(parsed);
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    expression = expression.slice(0, replacement.start - start) + replacement.text + expression.slice(replacement.end - start);
  return { locale: locale.initializer.text, expression: preservePluralOperands(expression) };
}

function preservePluralOperands(expression) {
  let source = `(${expression})`;
  const parsed = ts.createSourceFile("plural-data.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length) throw new TypeError("Invalid plural expression.");
  const initializers = {
    n: ["Math.abs(parseFloat(numStr))", "new BigDecimal(numStr).abs()"],
    i: ["Math.floor(Math.abs(parseFloat(integerPart)))", "new BigDecimal(integerPart).abs().floor()"],
    f: ["v > 0 ? parseInt(decimalPart, 10) : 0", 'new BigDecimal(decimalPart || "0")'],
    t: ['w > 0 ? parseInt(decimalPart.replace(/0+$/, ""), 10) : 0', 'new BigDecimal(decimalPart || "0").div(new BigDecimal(10).pow(decimalPart.length - w))']
  };
  const names = new Set();
  const replacements = [];
  const gather = node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && Object.hasOwn(initializers, node.name.text)) {
      const [expected, text] = initializers[node.name.text];
      if (node.initializer?.getText(parsed) !== expected) throw new TypeError(`Unexpected plural ${node.name.text} initializer.`);
      names.add(node.name.text);
      replacements.push({ start: node.initializer.getStart(parsed), end: node.initializer.end, text });
    }
    ts.forEachChild(node, gather);
  };
  gather(parsed);
  if (names.size === 0) return expression;
  const arithmetic = new Map([[ts.SyntaxKind.PercentToken, "mod"], [ts.SyntaxKind.PlusToken, "plus"], [ts.SyntaxKind.MinusToken, "minus"], [ts.SyntaxKind.AsteriskToken, "times"], [ts.SyntaxKind.SlashToken, "div"]]);
  const comparisons = new Map([[ts.SyntaxKind.EqualsEqualsEqualsToken, "eq"], [ts.SyntaxKind.EqualsEqualsToken, "eq"], [ts.SyntaxKind.ExclamationEqualsEqualsToken, "eq"], [ts.SyntaxKind.ExclamationEqualsToken, "eq"], [ts.SyntaxKind.LessThanToken, "lessThan"], [ts.SyntaxKind.GreaterThanToken, "greaterThan"], [ts.SyntaxKind.LessThanEqualsToken, "lessThanOrEqualTo"], [ts.SyntaxKind.GreaterThanEqualsToken, "greaterThanOrEqualTo"]]);
  const decimal = node => ts.isParenthesizedExpression(node) ? decimal(node.expression)
    : ts.isIdentifier(node) ? names.has(node.text)
    : ts.isBinaryExpression(node) && arithmetic.has(node.operatorToken.kind) && (decimal(node.left) || decimal(node.right));
  const render = node => {
    if (ts.isParenthesizedExpression(node)) return `(${render(node.expression)})`;
    if (ts.isCallExpression(node) && node.expression.getText(parsed) === "Number.isInteger" && node.arguments.length === 1 && decimal(node.arguments[0]))
      return `(${render(node.arguments[0])}).isInteger()`;
    if (!ts.isBinaryExpression(node)) return node.getText(parsed);
    const left = render(node.left), right = render(node.right), operator = node.operatorToken.kind;
    if (decimal(node.left) || decimal(node.right)) {
      const method = arithmetic.get(operator) ?? comparisons.get(operator);
      if (method === undefined) throw new TypeError("Unsupported exact plural operator.");
      const receiver = decimal(node.left) ? `(${left})` : `new BigDecimal(${left})`;
      const negate = operator === ts.SyntaxKind.ExclamationEqualsEqualsToken || operator === ts.SyntaxKind.ExclamationEqualsToken;
      return `${negate ? "!" : ""}${receiver}.${method}(${right})`;
    }
    return `(${left} ${node.operatorToken.getText(parsed)} ${right})`;
  };
  const conditions = node => {
    if (ts.isIfStatement(node)) replacements.push({ start: node.expression.getStart(parsed), end: node.expression.end, text: render(node.expression) });
    ts.forEachChild(node, conditions);
  };
  conditions(parsed);
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
  return source.slice(1, -1);
}

export function isolateNumberFormatEngine(source, license) {
  const parsed = ts.createSourceFile("numberformat.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length !== 0 || license.includes("*/")) throw new TypeError("Invalid number engine source.");
  let pluralReferences = 0;
  let sanctionedUnits;
  let denominatorReplacement;
  let unitCaseConversion;
  const pluralOperands = [];
  const inspect = node => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "IsWellFormedUnitIdentifier") {
      const first = node.body?.statements[0];
      if (unitCaseConversion !== undefined || first?.getText(parsed) !== "unit = toLowerCase(unit);")
        throw new TypeError("Unexpected unit case conversion.");
      unitCaseConversion = first;
    }
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "Intl")
      throw new TypeError("Number engine already declares Intl.");
    if (ts.isPropertyAccessExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "Intl" && node.name.text === "PluralRules") pluralReferences++;
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === "SANCTIONED_UNITS") {
      if (sanctionedUnits !== undefined || !ts.isArrayLiteralExpression(node.initializer) || !node.initializer.elements.every(ts.isStringLiteral))
        throw new TypeError("Unexpected sanctioned unit declaration.");
      sanctionedUnits = node.initializer;
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        ts.isIdentifier(node.expression.expression) && node.expression.expression.text === "denominatorPattern" && node.expression.name.text === "replace") {
      if (denominatorReplacement !== undefined || node.arguments.length !== 2 ||
          !node.arguments.every(ts.isStringLiteral) || node.arguments[0].text !== "{0}" || node.arguments[1].text !== "")
        throw new TypeError("Unexpected denominator pattern replacement.");
      denominatorReplacement = node;
    }
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "selectPlural") {
      const operand = node.arguments[1];
      if (ts.isCallExpression(operand) && ts.isPropertyAccessExpression(operand.expression) && operand.expression.name.text === "toNumber") {
        if (operand.arguments.length !== 0 || !["roundedNumber", "numberResult.roundedNumber.times(getPowerOf10(exponent))"].includes(operand.expression.expression.getText(parsed)))
          throw new TypeError("Unexpected plural numeric operand.");
        pluralOperands.push(operand.expression.name);
      }
    }
    ts.forEachChild(node, inspect);
  };
  inspect(parsed);
  if (pluralReferences === 0) throw new TypeError("Missing number engine plural dependency.");
  if (sanctionedUnits === undefined || !sanctionedUnits.elements.some(node => node.text === "duration-millisecond") ||
      sanctionedUnits.elements.some(node => ["duration-microsecond", "duration-nanosecond"].includes(node.text)))
    throw new TypeError("Unexpected sanctioned unit list.");
  const replacements = [{ start: sanctionedUnits.getStart(parsed), end: sanctionedUnits.end,
    text: JSON.stringify([...sanctionedUnits.elements.map(node => node.text), "duration-microsecond", "duration-nanosecond"]) }];
  if (denominatorReplacement === undefined) throw new TypeError("Missing denominator pattern replacement.");
  if (unitCaseConversion === undefined) throw new TypeError("Missing unit case conversion.");
  replacements.push({ start: unitCaseConversion.getStart(parsed), end: unitCaseConversion.end, text: "" });
  replacements.push({ start: denominatorReplacement.getStart(parsed), end: denominatorReplacement.end,
    text: `${denominatorReplacement.getText(parsed)}.trim()` });
  if (pluralOperands.length !== 5) throw new TypeError("Unexpected plural operand sites.");
  for (const operand of pluralOperands)
    replacements.push({ start: operand.getStart(parsed), end: operand.end, text: "toString" });
  const comments = ts.getLeadingCommentRanges(source, parsed.statements.at(-1)?.end ?? 0) ?? [];
  for (const comment of [...comments].reverse())
    if (comment.kind === ts.SyntaxKind.SingleLineCommentTrivia && source.slice(comment.pos, comment.end).startsWith("//# sourceMappingURL="))
      replacements.push({ start: comment.pos, end: comment.end, text: "" });
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
  return `/*!\n${license}\n*/\nimport { numberFormatIntl as Intl } from "../../interp/numberformat-pluralrules.js";\n${source}`;
}

export function numberFormatDataModule(values, license = "") {
  const sorted = [...values].sort((a, b) => a.locale < b.locale ? -1 : a.locale > b.locale ? 1 : 0);
  if (new Set(sorted.map(value => value.locale)).size !== sorted.length) throw new TypeError("Duplicate NumberFormat locale.");
  if (license.includes("*/")) throw new TypeError("Invalid locale-data license comment.");
  const nodes = [];
  const ids = new Map();
  const encode = value => {
    const key = JSON.stringify(value);
    if (ids.has(key)) return ids.get(key);
    const node = value === null || typeof value !== "object" ? value
      : Array.isArray(value) ? [0, ...value.map(encode)]
      : [1, ...Object.entries(value).flatMap(([name, child]) => [encode(name), encode(child)])];
    const id = nodes.length;
    nodes.push(node);
    ids.set(key, id);
    return id;
  };
  const roots = sorted.map(value => [value.locale, encode(value)]);
  // Intern serialized data, not live objects: each factory expands a fresh tree.
  // Parsing is deferred until the first locale request, including in source bundles.
  return (license === "" ? "" : `/*!\n${license}\n*/\n`) + "// Generated from pinned FormatJS locale data. Do not edit.\n" +
    `let nodes;\nfunction expand(id) {\n  nodes ??= JSON.parse(${JSON.stringify(JSON.stringify(nodes))});\n` +
    "  const node = nodes[id];\n  if (!Array.isArray(node)) return node;\n" +
    "  if (node[0] === 0) return node.slice(1).map(expand);\n" +
    "  const entries = [];\n  for (let index = 1; index < node.length; index += 2) entries.push([expand(node[index]), expand(node[index + 1])]);\n" +
    "  return Object.fromEntries(entries);\n}\nexport const localeData = Object.freeze({\n" +
    roots.map(([locale, id]) => `${JSON.stringify(locale)}: () => (expand(${id}))`).join(",\n") +
    "\n});\n";
}

export function isolatePluralRulesEngine(source, license) {
  const parsed = ts.createSourceFile("pluralrules.js", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  if (parsed.parseDiagnostics.length !== 0 || license.includes("*/")) throw new TypeError("Invalid plural engine source.");
  const selector = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "PluralRuleSelect");
  const resolver = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ResolvePluralInternal");
  if (selector?.parameters.length !== 4 || resolver === undefined) throw new TypeError("Unexpected plural engine selection shape.");
  const calls = [];
  const inspect = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "PluralRuleSelect") calls.push(node);
    ts.forEachChild(node, inspect);
  };
  inspect(resolver);
  const call = calls[0];
  if (calls.length !== 1 || call.arguments.map(argument => argument.getText(parsed)).join("|") !== "locale|type|n|GetOperands(s, exponent)")
    throw new TypeError("Unexpected plural engine operand path.");
  const classes = [];
  const findClass = node => {
    if ((ts.isClassExpression(node) || ts.isClassDeclaration(node)) && node.name?.text === "PluralRules") classes.push(node);
    ts.forEachChild(node, findClass);
  };
  findClass(parsed);
  const method = classes.length === 1 ? classes[0].members.find(node => ts.isMethodDeclaration(node) &&
    ts.isIdentifier(node.name) && node.name.text === "resolvedOptions") : undefined;
  const result = method?.body?.statements.at(-1);
  if (result === undefined || !ts.isReturnStatement(result) || !ts.isIdentifier(result.expression) || result.expression.text !== "opts")
    throw new TypeError("Unexpected plural engine resolved-options shape.");
  const range = parsed.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === "ResolvePluralRange");
  const guard = range?.body?.statements[0];
  if (guard === undefined || !ts.isIfStatement(guard) || !ts.isBinaryExpression(guard.expression) ||
      guard.expression.operatorToken.kind !== ts.SyntaxKind.BarBarToken || !ts.isThrowStatement(guard.thenStatement) ||
      ![guard.expression.left, guard.expression.right].every((node, index) => {
        if (!ts.isPrefixUnaryExpression(node) || node.operator !== ts.SyntaxKind.ExclamationToken) return false;
        const call = node.operand;
        return ts.isCallExpression(call) && call.arguments.length === 0 && ts.isPropertyAccessExpression(call.expression) &&
          ts.isIdentifier(call.expression.expression) && call.expression.expression.text === (index === 0 ? "x" : "y") &&
          call.expression.name.text === "isFinite";
      })) throw new TypeError("Unexpected plural engine range guard.");
  // Pass the already-rounded decimal text directly to the CLDR rule. Rebuilding
  // it from numeric fraction operands loses leading/trailing zeros and precision.
  const replacements = [
    { start: guard.getStart(parsed), end: guard.end,
      text: 'if (x.isNaN() || y.isNaN()) throw new RangeError("selectRange endpoints must not be NaN");' },
    { start: result.getStart(parsed), end: result.getStart(parsed),
      text: ["roundingIncrement", "roundingMode", "roundingPriority", "trailingZeroDisplay"]
        .map(field => `opts.${field} = internalSlots.${field};`).join("\n") + "\n" },
    { start: call.getStart(parsed), end: call.end, text: "PluralRuleSelect(locale, type, s, exponent)" },
    { start: selector.getStart(parsed), end: selector.end,
      text: 'function PluralRuleSelect(locale, type, formattedString, exponent) {\n  return PluralRules.localeData[locale].fn(formattedString, type === "ordinal", exponent);\n}' }
  ];
  for (const comment of ts.getLeadingCommentRanges(source, parsed.statements.at(-1)?.end ?? 0) ?? [])
    if (comment.kind === ts.SyntaxKind.SingleLineCommentTrivia && source.slice(comment.pos, comment.end).startsWith("//# sourceMappingURL="))
      replacements.push({ start: comment.pos, end: comment.end, text: "" });
  for (const replacement of replacements.sort((a, b) => b.start - a.start))
    source = source.slice(0, replacement.start) + replacement.text + source.slice(replacement.end);
  return `/*!\n${license}\n*/\n${source}`;
}

async function generate() {
  const packageDirectory = fileURLToPath(new URL("../", import.meta.url));
  const output = resolve(packageDirectory, "src/intl-data/dist");
  if (process.argv.includes("--copy")) {
    const destination = resolve(packageDirectory, "dist/intl-data/dist");
    await mkdir(destination, { recursive: true });
    for (const name of ["numberformat.js", "numberformat.d.ts", "numberformat-engine.js", "numberformat-engine.d.ts", "pluralrules.js", "pluralrules.d.ts", "pluralrules-engine.js", "pluralrules-engine.d.ts"])
      await copyFile(resolve(output, name), resolve(destination, name));
    return;
  }
  const require = createRequire(import.meta.url);
  const dataDirectory = resolve(dirname(require.resolve("@formatjs/intl-numberformat")), "locale-data");
  const unitDirectory = dirname(require.resolve("cldr-units-full/package.json"));
  const values = [];
  for (const filename of (await readdir(dataDirectory)).filter(name => name.endsWith(".js")).sort()) {
    const value = extractNumberFormatData(await readFile(resolve(dataDirectory, filename), "utf8"), filename);
    const units = JSON.parse(await readFile(resolve(unitDirectory, "main", value.locale, "units.json"), "utf8"));
    values.push(mergeSubsecondUnitData(value, units));
  }
  if (values.length === 0) throw new Error("Missing NumberFormat locale data.");
  await mkdir(output, { recursive: true });
  const license = await readFile(resolve(dataDirectory, "../LICENSE.md"), "utf8");
  const unitLicense = await readFile(resolve(unitDirectory, "LICENSE"), "utf8");
  const source = numberFormatDataModule(values, `${license}\n\nSupplemental unit data:\n${unitLicense}`);
  await writeFile(resolve(output, "numberformat.js"), source);
  await writeFile(resolve(output, "numberformat.d.ts"), 'import type { NumberFormat } from "@formatjs/intl-numberformat";\nexport declare const localeData: Readonly<Record<string, () => Parameters<typeof NumberFormat.__addLocaleData>[0]>>;\n');
  const engine = isolateNumberFormatEngine(await readFile(require.resolve("@formatjs/intl-numberformat"), "utf8"), license);
  await writeFile(resolve(output, "numberformat-engine.js"), engine);
  await writeFile(resolve(output, "numberformat-engine.d.ts"), 'export { NumberFormat } from "@formatjs/intl-numberformat";\n');
  const pluralDirectory = resolve(dirname(require.resolve("@formatjs/intl-pluralrules")), "locale-data");
  const pluralValues = [];
  for (const filename of (await readdir(pluralDirectory)).filter(name => name.endsWith(".js")).sort())
    pluralValues.push(extractPluralRulesData(await readFile(resolve(pluralDirectory, filename), "utf8"), filename));
  if (pluralValues.length === 0 || new Set(pluralValues.map(value => value.locale)).size !== pluralValues.length)
    throw new Error("Missing or duplicate plural locale data.");
  const pluralLicense = await readFile(resolve(pluralDirectory, "../LICENSE.md"), "utf8");
  if (pluralLicense.includes("*/")) throw new TypeError("Invalid plural locale license.");
  await writeFile(resolve(output, "pluralrules-engine.js"), isolatePluralRulesEngine(await readFile(require.resolve("@formatjs/intl-pluralrules"), "utf8"), pluralLicense));
  await writeFile(resolve(output, "pluralrules-engine.d.ts"), 'export { PluralRules } from "@formatjs/intl-pluralrules";\n');
  const pluralSource = `/*!\n${pluralLicense}\n*/\nimport { BigDecimal } from "@formatjs/bigdecimal";\nexport const pluralData = Object.freeze({\n` +
    pluralValues.map(value => `${JSON.stringify(value.locale)}: () => (${value.expression})`).join(",\n") + "\n});\n";
  await writeFile(resolve(output, "pluralrules.js"), pluralSource);
  await writeFile(resolve(output, "pluralrules.d.ts"), 'import type { PluralRules } from "@formatjs/intl-pluralrules";\nexport declare const pluralData: Readonly<Record<string, () => Parameters<typeof PluralRules.__addLocaleData>[0]>>;\n');
  console.log(JSON.stringify({ numberFormatLocales: values.length, sourceBytes: Buffer.byteLength(source), pluralLocales: pluralValues.length }));
}

if (process.argv[1] !== undefined && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) await generate();
