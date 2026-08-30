export function byteLocale(variables: Readonly<Record<string, string>>): boolean {
  const locale = variables.LC_ALL || variables.LC_CTYPE || variables.LANG;
  return locale === "C" || locale === "POSIX";
}
