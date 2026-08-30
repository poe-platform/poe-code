export function byteLocale(variables) {
    const locale = variables.LC_ALL || variables.LC_CTYPE || variables.LANG;
    return locale === "C" || locale === "POSIX";
}
//# sourceMappingURL=locale.js.map