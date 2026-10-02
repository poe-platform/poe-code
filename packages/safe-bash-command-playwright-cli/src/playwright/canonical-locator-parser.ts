/**
 * Derived from Microsoft Playwright's packages/isomorphic/locatorParser.ts,
 * locatorUtils.ts and stringUtils.ts as shipped with @playwright/cli 0.1.20.
 * Copyright (c) Microsoft Corporation. Licensed under Apache-2.0.
 * https://github.com/microsoft/playwright/blob/main/LICENSE
 * Kept as data parsing only; expressions are never evaluated as host JavaScript.
 * The native locator supplies round-trip validation in locator-selector.ts.
 */
function escapeRegexForSelector(re2: RegExp) {
  if (re2.unicode || Reflect.get(re2, 'unicodeSets'))
    return String(re2);
  return String(re2).replace(/(^|[^\\])(\\\\)*(["'`])/g, "$1$2\\$3").replace(/>>/g, "\\>\\>");
}
function escapeForTextSelector(text2: string | RegExp, exact: boolean) {
  if (typeof text2 !== "string")
    return escapeRegexForSelector(text2);
  return `${JSON.stringify(text2)}${exact ? "s" : "i"}`;
}
function escapeForAttributeSelector(value2: string | RegExp, exact: boolean) {
  if (typeof value2 !== "string")
    return escapeRegexForSelector(value2);
  return `"${value2.replace(/\\/g, "\\\\").replace(/["]/g, '\\"')}"${exact ? "s" : "i"}`;
}
function encodeTestIdAttributeName(testIdAttributeName2: string) {
  return testIdAttributeName2.includes(",") ? JSON.stringify(testIdAttributeName2) : testIdAttributeName2;
}
export function parseCanonicalPlaywrightLocator(locator2: string, testIdAttributeName2 = 'data-testid') {
  locator2 = locator2.replace(/AriaRole\s*\.\s*([\w]+)/g, (_, group) => group.toLowerCase()).replace(/(get_by_role|getByRole)\s*\(\s*(?:["'`])([^'"`]+)['"`]/g, (_, group1, group2) => `${group1}(${group2.toLowerCase()}`);
  const params2: {quote: string; text: string}[] = [];
  let template = "";
  for (let i = 0; i < locator2.length; ++i) {
    const quote5 = locator2[i];
    if (quote5 !== '"' && quote5 !== "'" && quote5 !== "`" && quote5 !== "/") {
      template += quote5;
      continue;
    }
    const isRegexEscaping = locator2[i - 1] === "r" || locator2[i] === "/";
    ++i;
    let text2 = "";
    while (i < locator2.length) {
      if (locator2[i] === "\\") {
        if (isRegexEscaping) {
          if (locator2[i + 1] !== quote5)
            text2 += locator2[i];
          ++i;
          text2 += locator2[i];
        } else {
          ++i;
          if (locator2[i] === "n")
            text2 += "\n";
          else if (locator2[i] === "r")
            text2 += "\r";
          else if (locator2[i] === "t")
            text2 += "	";
          else
            text2 += locator2[i];
        }
        ++i;
        continue;
      }
      if (locator2[i] !== quote5) {
        text2 += locator2[i++];
        continue;
      }
      break;
    }
    params2.push({ quote: quote5, text: text2 });
    template += (quote5 === "/" ? "r" : "") + "$" + params2.length;
  }
  template = template.toLowerCase().replace(/get_by_alt_text/g, "getbyalttext").replace(/get_by_test_id/g, "getbytestid").replace(/get_by_([\w]+)/g, "getby$1").replace(/has_not_text/g, "hasnottext").replace(/has_text/g, "hastext").replace(/has_not/g, "hasnot").replace(/frame_locator/g, "framelocator").replace(/content_frame/g, "contentframe").replace(/[{}\s]/g, "").replace(/new\(\)/g, "").replace(/new[\w]+\.[\w]+options\(\)/g, "").replace(/\.set/g, ",set").replace(/\.or_\(/g, "or(").replace(/\.and_\(/g, "and(").replace(/:/g, "=").replace(/,re\.ignorecase/g, "i").replace(/,pattern.case_insensitive/g, "i").replace(/,regexoptions.ignorecase/g, "i").replace(/re.compile\(([^)]+)\)/g, "$1").replace(/pattern.compile\(([^)]+)\)/g, "r$1").replace(/newregex\(([^)]+)\)/g, "r$1").replace(/string=/g, "=").replace(/regex=/g, "=").replace(/,,/g, ",").replace(/,\)/g, ")");
  const preferredQuote = params2.map((p) => p.quote).filter((quote5) => "'\"`".includes(quote5))[0];
  return { selector: transform(template, params2, testIdAttributeName2), preferredQuote };
}
function countParams(template: string) {
  return [...template.matchAll(/\$\d+/g)].length;
}
function shiftParams(template: string, sub: number) {
  return template.replace(/\$(\d+)/g, (_, ordinal) => `$${Number(ordinal) - sub}`);
}
function transform(template: string, params2: {quote: string; text: string}[], testIdAttributeName2: string): string {
  while (true) {
    const hasMatch = template.match(/filter\(,?(has=|hasnot=|sethas\(|sethasnot\()/);
    if (!hasMatch)
      break;
    const start3 = hasMatch.index! + hasMatch[0].length;
    let balance = 0;
    let end = start3;
    for (; end < template.length; end++) {
      if (template[end] === "(")
        balance++;
      else if (template[end] === ")")
        balance--;
      if (balance < 0)
        break;
    }
    let prefix = template.substring(0, start3);
    let extraSymbol = 0;
    if (["sethas(", "sethasnot("].includes(hasMatch[1]!)) {
      extraSymbol = 1;
      prefix = prefix.replace(/sethas\($/, "has=").replace(/sethasnot\($/, "hasnot=");
    }
    const paramsCountBeforeHas = countParams(template.substring(0, start3));
    const hasTemplate = shiftParams(template.substring(start3, end), paramsCountBeforeHas);
    const paramsCountInHas = countParams(hasTemplate);
    const hasParams = params2.slice(paramsCountBeforeHas, paramsCountBeforeHas + paramsCountInHas);
    const hasSelector = JSON.stringify(transform(hasTemplate, hasParams, testIdAttributeName2));
    template = prefix.replace(/=$/, "2=") + `$${paramsCountBeforeHas + 1}` + shiftParams(template.substring(end + extraSymbol), paramsCountInHas - 1);
    const paramsBeforeHas = params2.slice(0, paramsCountBeforeHas);
    const paramsAfterHas = params2.slice(paramsCountBeforeHas + paramsCountInHas);
    params2 = paramsBeforeHas.concat([{ quote: '"', text: hasSelector }]).concat(paramsAfterHas);
  }
  template = template.replace(/,set([\w]+)\(([^)]+)\)/g, (_, group1, group2) => "," + group1.toLowerCase() + "=" + group2.toLowerCase()).replace(/framelocator\(\)/g, "internal:control=any-frame").replace(/framelocator\(([^)]+)\)/g, "$1.internal:control=enter-frame").replace(/contentframe(\(\))?/g, "internal:control=enter-frame").replace(/locator\(([^)]+),hastext=([^),]+)\)/g, "locator($1).internal:has-text=$2").replace(/locator\(([^)]+),hasnottext=([^),]+)\)/g, "locator($1).internal:has-not-text=$2").replace(/locator\(([^)]+),hastext=([^),]+)\)/g, "locator($1).internal:has-text=$2").replace(/locator\(([^)]+)\)/g, "$1").replace(/getbyrole\(([^)]+)\)/g, "internal:role=$1").replace(/getbytext\(([^)]+)\)/g, "internal:text=$1").replace(/getbylabel\(([^)]+)\)/g, "internal:label=$1").replace(/getbytestid\(([^)]+)\)/g, `internal:testid=[${encodeTestIdAttributeName(testIdAttributeName2)}=$1]`).replace(/getby(placeholder|alt|title)(?:text)?\(([^)]+)\)/g, "internal:attr=[$1=$2]").replace(/first(\(\))?/g, "nth=0").replace(/last(\(\))?/g, "nth=-1").replace(/nth\(([^)]+)\)/g, "nth=$1").replace(/filter\(,?visible=true\)/g, "visible=true").replace(/filter\(,?visible=false\)/g, "visible=false").replace(/\.visible(\(\))?(?!=)/g, ".visible=true").replace(/filter\(,?hastext=([^)]+)\)/g, "internal:has-text=$1").replace(/filter\(,?hasnottext=([^)]+)\)/g, "internal:has-not-text=$1").replace(/filter\(,?has2=([^)]+)\)/g, "internal:has=$1").replace(/filter\(,?hasnot2=([^)]+)\)/g, "internal:has-not=$1").replace(/,exact=false/g, "").replace(/(,name=\$\d+)(,description=\$\d+),exact=true/g, "$1s$2s").replace(/,exact=true/g, "s").replace(/,includehidden=/g, ",include-hidden=").replace(/,/g, "][");
  const parts = template.split(".");
  for (let index = 0; index < parts.length - 1; index++) {
    if (parts[index] === "internal:control=enter-frame" && parts[index + 1]!.startsWith("nth=")) {
      const [nth] = parts.splice(index, 1);
      parts.splice(index + 1, 0, nth!);
    }
  }
  return parts.map((t) => {
    if (!t.startsWith("internal:") || t === "internal:control")
      return t.replace(/\$(\d+)/g, (_, ordinal) => {
        const param = params2[+ordinal - 1]!;
        return param.text;
      });
    t = t.includes("[") ? t.replace(/\]/, "") + "]" : t;
    t = t.replace(/(?:r)\$(\d+)(i)?/g, (_, ordinal, suffix) => {
      const param = params2[+ordinal - 1]!;
      if (t.startsWith("internal:attr") || t.startsWith("internal:testid") || t.startsWith("internal:role"))
        return escapeForAttributeSelector(new RegExp(param.text), false) + (suffix || "");
      return escapeForTextSelector(new RegExp(param.text, suffix), false);
    }).replace(/\$(\d+)(i|s)?/g, (_, ordinal, suffix) => {
      const param = params2[+ordinal - 1]!;
      if (t.startsWith("internal:has=") || t.startsWith("internal:has-not="))
        return param.text;
      if (t.startsWith("internal:testid"))
        return escapeForAttributeSelector(param.text, true);
      if (t.startsWith("internal:attr") || t.startsWith("internal:role"))
        return escapeForAttributeSelector(param.text, suffix === "s");
      return escapeForTextSelector(param.text, suffix === "s");
    });
    return t;
  }).join(" >> ");
}
