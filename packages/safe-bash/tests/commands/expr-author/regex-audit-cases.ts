export function nullableAuditCases() {
  const patterns = [
    "\\(a*\\)*", "\\(a*\\)\\+", "\\(a*\\)\\{2\\}", "\\(a*\\)\\{1,3\\}", "\\(a\\|aa\\)*",
    "\\(a*\\|b*\\)*", "\\(a*\\|b\\)*", "\\(a\\|ab\\)*", "\\(a*\\)\\1", "\\(a*\\)b*\\1",
    "\\(a*\\)\\(b*\\)\\1\\2", "\\(a*\\)*b", "\\(a*\\)*\\1", "\\(a\\)\\?\\(b\\)\\?",
    "\\(a*\\)\\|\\(b*\\)", "a*\\(a*\\)", "\\(a*\\)a*", "\\(a\\|\\)a*", "\\(a\\|ab\\)b*",
    "\\(a*\\)*\\(a*\\)", "\\(\\(a\\)*b\\)*",
  ];
  const subjects = ["", "a", "aa", "aaa", "b", "ab", "aba", "abab", "aab", "abb", "ba"];
  return patterns.flatMap((pattern, patternIndex) => subjects.map((subject, subjectIndex) => ({
    name: `nullable-audit/${patternIndex}/${subjectIndex}`, locale: "C",
    args: ["+", subject, ":", pattern],
  })));
}
