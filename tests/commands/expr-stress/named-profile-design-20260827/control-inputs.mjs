export function controls() {
  const rows = [];
  const add = (id, env, operation, expected, extra = {}) => rows.push({ id, env, operation, expected, ...extra });
  const allow = profile => ({ decision: "allow", profile, stderr: "" });
  const encodingRefusal = { decision: "refuse", profile: null, stderr: "expr: character operations require C/POSIX, C.UTF-8/C.utf8, or qualified en_US.UTF-8 encoding\n" };
  const collationRefusal = { decision: "refuse", profile: null, stderr: "expr: string comparison requires C/POSIX or C.UTF-8/C.utf8 byte collation\n" };
  const bracketRefusal = profile => ({ decision: "refuse", profile, stderr: "expr: unsupported BRE: bracket expressions require C/POSIX or C.UTF-8/C.utf8 LC_CTYPE and LC_COLLATE\n" });
  const baseline = ["C", "POSIX", "C.UTF-8", "C.utf8"];
  const unsupported = ["en_US.utf8", "en_US.UTF8", "en_us.UTF-8", "EN_US.UTF-8", "en-US.UTF-8", "en_US.UTF-8@x", "C.UTF8", "C.utf-8", "UTF-8", "de_DE.UTF-8", "fr_FR.UTF-8", " en_US.UTF-8", "en_US.UTF-8 ", " ", "/usr/share/locale/en_US.UTF-8", "xx_YY.UTF-8"];
  for (const locale of [...baseline, "en_US.UTF-8"]) {
    const profile = locale === "C" || locale === "POSIX" ? "byte" : "utf8-scalar";
    for (const operation of ["length", "substr", "index"]) add(`name:${locale}:${operation}`, { LC_ALL: locale }, operation, allow(profile));
    add(`name:${locale}:comparison`, { LC_ALL: locale }, "string-comparison", locale === "en_US.UTF-8" ? collationRefusal : allow(null));
  }
  for (const locale of unsupported) {
    add(`reject-name:${locale}:length`, { LC_ALL: locale }, "length", encodingRefusal);
    add(`reject-name:${locale}:comparison`, { LC_ALL: locale }, "string-comparison", collationRefusal);
    add(`irrelevant-name:${locale}:arithmetic`, { LC_ALL: locale }, "arithmetic", allow(null), { argv: ["40", "+", "2"], stdout: "42\n" });
  }
  const selectors = [
    ["default-unset", {}, ["virtual-default", "C"], ["virtual-default", "C"]],
    ["default-empty", { LC_ALL: "", LC_CTYPE: "", LC_COLLATE: "", LANG: "" }, ["virtual-default", "C"], ["virtual-default", "C"]],
    ["all-wins", { LC_ALL: "C", LC_CTYPE: "en_US.UTF-8", LC_COLLATE: "en_US.UTF-8", LANG: "unknown" }, ["LC_ALL", "C"], ["LC_ALL", "C"]],
    ["all-named-wins", { LC_ALL: "en_US.UTF-8", LC_CTYPE: "C", LC_COLLATE: "C", LANG: "C" }, ["LC_ALL", "en_US.UTF-8"], ["LC_ALL", "en_US.UTF-8"]],
    ["empty-all-categories-win", { LC_ALL: "", LC_CTYPE: "en_US.UTF-8", LC_COLLATE: "C", LANG: "unknown" }, ["LC_CTYPE", "en_US.UTF-8"], ["LC_COLLATE", "C"]],
    ["ctype-empty-lang", { LC_ALL: "", LC_CTYPE: "", LC_COLLATE: "C", LANG: "en_US.UTF-8" }, ["LANG", "en_US.UTF-8"], ["LC_COLLATE", "C"]],
    ["collate-empty-lang", { LC_ALL: "", LC_CTYPE: "C", LC_COLLATE: "", LANG: "en_US.UTF-8" }, ["LC_CTYPE", "C"], ["LANG", "en_US.UTF-8"]],
    ["only-lang", { LANG: "en_US.UTF-8" }, ["LANG", "en_US.UTF-8"], ["LANG", "en_US.UTF-8"]],
    ["all-invalid-no-fallback", { LC_ALL: "unknown", LC_CTYPE: "C", LC_COLLATE: "C", LANG: "C" }, ["LC_ALL", "unknown"], ["LC_ALL", "unknown"]],
    ["category-invalid-no-fallback", { LC_CTYPE: "unknown", LC_COLLATE: "unknown", LANG: "C" }, ["LC_CTYPE", "unknown"], ["LC_COLLATE", "unknown"]],
    ["space-not-empty", { LC_ALL: " ", LC_CTYPE: "C", LC_COLLATE: "C", LANG: "C" }, ["LC_ALL", " "], ["LC_ALL", " "]],
    ["ctype-does-not-set-collate", { LC_CTYPE: "en_US.UTF-8" }, ["LC_CTYPE", "en_US.UTF-8"], ["virtual-default", "C"]],
    ["collate-does-not-set-ctype", { LC_COLLATE: "en_US.UTF-8" }, ["virtual-default", "C"], ["LC_COLLATE", "en_US.UTF-8"]],
    ["messages-not-ctype", { LC_MESSAGES: "en_US.UTF-8", LANGUAGE: "en_US.UTF-8" }, ["virtual-default", "C"], ["virtual-default", "C"]],
  ].map(([id, env, character, collation]) => ({ id, env, expected: {
    character: { selectedBy: character[0], value: character[1] },
    collation: { selectedBy: collation[0], value: collation[1] },
  } }));
  const bracketPatterns = ["[a-z]", "[A-Z]", "[0-9]", "[[:alpha:]]", "[[:digit:]]", "[[:space:]]", "[[=a=]]", "[[.a.]]", "[a]", "[^a]", "[é]", "[[]", "[", "a\\|[a-z]", "\\(a\\)[a-z]", "\\\\[a-z]", "\\\\\\\\[a-z]"];
  const mixed = [
    ["named-all", { LC_ALL: "en_US.UTF-8" }, "utf8-scalar"],
    ["named-ctype-c-collate", { LC_CTYPE: "en_US.UTF-8", LC_COLLATE: "C" }, "utf8-scalar"],
    ["c-ctype-named-collate", { LC_CTYPE: "C", LC_COLLATE: "en_US.UTF-8" }, "byte"],
    ["scalar-ctype-named-collate", { LC_CTYPE: "C.UTF-8", LC_COLLATE: "en_US.UTF-8" }, "utf8-scalar"],
    ["c-ctype-unknown-collate", { LC_CTYPE: "C", LC_COLLATE: "unknown" }, "byte"],
    ["named-ctype-unknown-collate", { LC_CTYPE: "en_US.UTF-8", LC_COLLATE: "unknown" }, "utf8-scalar"],
  ];
  for (const [id, env, profile] of mixed) {
    for (const [patternIndex, pattern] of bracketPatterns.entries()) {
      for (const subject of ["a", "", "é"]) add(`bracket:${id}:${patternIndex}:${subject || "empty"}`, env, "match", bracketRefusal(profile), { pattern, subject });
    }
    for (const [patternIndex, pattern] of ["é", ".", "A..", "\\(.\\)", "Aé\\(.\\)", "\\(e.\\)", "\\(é\\)\\1", "\\[", "\\\\\\[", "\\", "\\w", "\\1"].entries()) {
      add(`worker-admission:${id}:${patternIndex}`, env, "match", allow(profile), { pattern, qualification: "Admission only; existing worker syntax, unsupported features and resource limits remain authoritative." });
    }
    add(`collate-irrelevant:${id}:length`, env, "length", allow(profile));
  }
  for (const ctype of baseline) for (const collate of baseline) {
    const profile = ctype === "C" || ctype === "POSIX" ? "byte" : "utf8-scalar";
    for (const pattern of ["[a-z]", "[[:alpha:]]", "["]) add(`baseline:${ctype}:${collate}:${pattern}`, { LC_CTYPE: ctype, LC_COLLATE: collate }, "match", allow(profile), { pattern, qualification: "Admission only, existing worker semantics unchanged; mixed codesets are virtual controls, not native parity." });
  }
  for (const operator of ["<", "<=", "=", "==", "!=", ">=", ">"]){
    add(`named-string-relation:${operator}`, { LC_ALL: "en_US.UTF-8" }, "string-comparison", collationRefusal, { argv: ["a", operator, "b"] });
    add(`numeric-relation:${operator}`, { LC_ALL: "unknown" }, "numeric-comparison", allow(null), { argv: ["1", operator, "2"] });
  }
  add("unknown-ctype-qualified-collate", { LC_CTYPE: "unknown", LC_COLLATE: "C" }, "string-comparison", allow(null));
  add("unknown-ctype-does-not-borrow-collate", { LC_CTYPE: "unknown", LC_COLLATE: "C.UTF-8" }, "length", encodingRefusal);
  add("literal-value-no-category", { LC_ALL: "unknown" }, "literal-value", allow(null), { argv: ["é"] });
  return { schema: 1, kind: "design-expectations-not-product-acceptance", selectors, rows };
}
