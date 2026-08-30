export interface RegexCase { name: string; args: readonly string[]; locale: string }

export function regexCases(): RegexCase[] {
  const controls: readonly [string, string, string][] = [
    ["anchored-not-search", "ba", "a"], ["anchored-start", "abc", "^a"],
    ["newline-dot", "a\nb", ".*$"], ["newline-end-not-before-final-LF", "a\n", "a$"],
    ["empty-pattern", "abc", ""], ["empty-subject", "", "a*"],
    ["plain-length", "abc", "ab"], ["first-capture", "abc", "a\\(.\\)c"],
    ["empty-capture", "abc", "\\(\\)"], ["absent-capture", "b", "a"],
    ["unmatched-capture", "b", "\\(a\\)\\?b"], ["failed-capture", "b", "\\(a\\)"],
    ["capture-other-alternative", "b", "a\\(x\\)\\|b"],
    ["first-not-last-group", "abc", "\\(a\\)\\(b\\)c"],
    ["leftmost-longest", "ab", "a\\|ab"], ["first-alternative-tie", "aaa", "\\(a\\|aa\\)a*"],
    ["greedy-capture-tie", "aaa", "\\(a*\\)a*"], ["longer-alternative", "aaa", "\\(a\\|aaa\\)"],
    ["basename", "/tmp/path/file.txt", ".*/\\(.*\\)"],
    ["extension", "file.txt", ".*\\.\\([^.]*\\)$"],
    ["version", "v12.34.5", "v\\([0-9]\\+\\)\\."],
    ["backreference", "abab", "\\(ab\\)\\1"], ["failed-backreference", "abac", "\\(ab\\)\\1"],
    ["empty-backreference", "abc", "\\(\\)\\1"], ["unmatched-backreference", "b", "\\(a\\)\\?\\1b"],
    ["nested-backreference", "abab", "\\(\\(ab\\)\\2\\)"],
    ["repeated-capture", "abab", "\\(ab\\)*"], ["nullable-repeated-capture", "aa", "\\(a*\\)*"],
    ["star", "aaa", "a*"], ["plus", "aaa", "a\\+"], ["question", "aa", "a\\?"],
    ["interval-exact", "aaaa", "a\\{2\\}"], ["interval-range", "aaaa", "a\\{1,3\\}"],
    ["interval-open", "aaaa", "a\\{2,\\}"], ["interval-zero", "aaaa", "a\\{0\\}"],
    ["interval-group", "ababab", "\\(ab\\)\\{1,2\\}"],
    ["literal-ERE", "(a)+?|{}", "(a)+?|{}"], ["literal-dot", "a.b", "a\\.b"],
    ["literal-slash", "a/b", "a\\/b"], ["literal-backslash", "a\\b", "a\\\\b"],
    ["literal-middle-caret", "a^b", "a^b"], ["literal-middle-dollar", "a$b", "a$b"],
    ["literal-leading-star", "*a", "*a"], ["literal-bracket-in-class", "[", "[[]"],
    ["literal-close-in-class", "]", "[]a]"], ["literal-hyphen", "-", "[-a]"],
    ["negated-class", "z", "[^ab]"], ["empty-range", "b", "[z-a]"],
    ["ascii-range", "abc123", "[a-z]*"], ["digits", "123abc", "[[:digit:]]*"],
    ["space", " \t\nX", "[[:space:]]*"], ["alnum", "Az12!", "[[:alnum:]]*"],
    ["punct", "!?a", "[[:punct:]]*"], ["hex", "aF09Z", "[[:xdigit:]]*"],
    ["empty-alternative", "ab", "\\|ab"], ["group-anchor", "abc", "\\(^ab\\)"],
    ["alternative-anchor", "abc", "x\\|^abc$"],
    ["unicode-dot", "😀é", "."], ["unicode-two-dots", "😀é", ".."],
    ["unicode-capture", "😀é", "\\(.\\)"], ["unicode-literal", "éé", "é*"],
    ["unicode-backref", "😀😀", "\\(😀\\)\\1"], ["unicode-class-literal", "é", "[é]"],
    ["combining-mark", "é", ".."], ["BOM-is-input", "﻿x", "."],
    ["invalid-empty-bracket", "", "["], ["invalid-unclosed-bracket", "", "[abc"],
    ["invalid-trailing-backslash", "", "\\"], ["invalid-open-group", "", "\\("],
    ["invalid-close-group", "", "\\)"], ["invalid-backreference", "", "\\1"],
    ["invalid-open-backreference", "", "\\(a\\1\\)"], ["invalid-class", "", "[[:bogus:]]"],
    ["invalid-interval-order", "", "a\\{3,1\\}"],
  ];
  return ["C", "C.UTF-8"].flatMap(locale => controls.map(([name, subject, pattern], index) => ({
    name: `${locale}/${name}`, locale,
    args: index % 2 ? ["match", "+", subject, "+", pattern] : ["+", subject, ":", "+", pattern],
  })));
}

export function unsupportedRegexCases(): RegexCase[] {
  return [
    { name: "GNU-word-extension", args: ["abc", ":", "\\w*"], locale: "C" },
    { name: "GNU-stacked-repeat", args: ["aa", ":", "a**"], locale: "C" },
    { name: "GNU-alphabetic-escape", args: ["a", ":", "\\a"], locale: "C" },
    { name: "collating-symbol", args: ["a", ":", "[[.a.]]"], locale: "C" },
    { name: "Unicode-class", args: ["é", ":", "[[:alpha:]]"], locale: "C.UTF-8" },
    { name: "Unicode-range", args: ["é", ":", "[à-ö]"], locale: "C.UTF-8" },
  ];
}
