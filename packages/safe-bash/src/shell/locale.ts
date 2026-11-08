export function byteLocale(variables: Readonly<Record<string, string>>): boolean {
  const locale = variables.LC_ALL || variables.LC_CTYPE || variables.LANG;
  return locale === "C" || locale === "POSIX";
}
export function cCollation(locale: string): boolean {
  return ["C", "POSIX", "C.UTF-8", "C.utf8"].includes(locale);
}

export function utf8Locale(locale: string): boolean {
  const encoding = locale.split(".")[1]?.split("@")[0]?.toLowerCase();
  return encoding === "utf-8" || encoding === "utf8";
}
