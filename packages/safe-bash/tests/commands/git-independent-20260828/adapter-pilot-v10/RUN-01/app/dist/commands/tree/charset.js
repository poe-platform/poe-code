import { UsageError } from "./io.js";
const utf8Locales = new Set(["C.UTF-8", "C.utf8", "en_US.UTF-8", "en_US.utf8"]);
export function explicitCharset(value) {
    const normalized = value.toUpperCase();
    if (normalized === "UTF-8" || normalized === "UTF8")
        return "UTF-8";
    if (normalized === "ASCII" || normalized === "US-ASCII")
        return "ASCII";
    throw new UsageError("supported charsets: ASCII, US-ASCII, UTF-8, UTF8");
}
export function environmentCharset(budget) {
    const { env } = budget.context;
    const ownValue = (name) => {
        if (!Object.hasOwn(env, name))
            return undefined;
        const value = env[name];
        if (value === undefined)
            return undefined;
        budget.check(value.length, budget.limits.maxPathBytes, "path/name");
        budget.step(value.length + 1);
        budget.text(value);
        return value;
    };
    const configured = ownValue("TREE_CHARSET");
    if (configured !== undefined) {
        const normalized = configured.toUpperCase();
        return normalized === "UTF-8" || normalized === "UTF8" ? "UTF-8" : "ASCII";
    }
    for (const name of ["LC_ALL", "LC_CTYPE", "LANG"]) {
        const locale = ownValue(name);
        if (locale)
            return utf8Locales.has(locale) ? "UTF-8" : "ASCII";
    }
    return "ASCII";
}
//# sourceMappingURL=charset.js.map