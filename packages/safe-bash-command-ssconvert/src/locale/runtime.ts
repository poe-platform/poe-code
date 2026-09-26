import { SsconvertError, type Environment } from "../contracts.js";

const capturedLocales: Readonly<Record<string, "C" | "C.UTF-8">> = Object.freeze({
  C: "C", POSIX: "C", "C.UTF-8": "C.UTF-8", "C.utf8": "C.UTF-8"
});

/** glibc setlocale("", category): nonempty LC_ALL, category, LANG, then C. */
export function localeCategory(environment: Environment, category: "LC_CTYPE" | "LC_NUMERIC" | "LC_TIME"): string {
  const env = environment.env;
  const requested = env.LC_ALL || env[category] || env.LANG;
  if (requested === undefined && env.LC_ALL === undefined && env[category] === undefined && env.LANG === undefined)
    return environment.locale;
  const name = requested || "C";
  const captured = Object.hasOwn(capturedLocales, name) ? capturedLocales[name] : undefined;
  if (captured === undefined)
    throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: uncaptured runtime locale ${name}`);
  return captured;
}

/** The converter captures LC_CTYPE when opened, before the export locale override. */
export function converterLocale(environment: Environment): "C" | "C.UTF-8" {
  const name = localeCategory(environment, "LC_CTYPE");
  const captured = Object.hasOwn(capturedLocales, name) ? capturedLocales[name] : undefined;
  if (captured === undefined)
    throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: uncaptured transliteration locale ${name}`);
  return captured;
}

/** Resolve only injected state. Never consult process.env or mutate host locale/TZ. */
export function runtimeEnvironment(environment: Environment): Environment {
  const locale = localeCategory(environment, "LC_NUMERIC");
  // Both installed profiles have identical numeric/time data. A missing category
  // is an explicit gap rather than an accidental host-dependent fallback.
  localeCategory(environment, "LC_CTYPE");
  localeCategory(environment, "LC_TIME");
  const timezone = environment.env.TZ === "" ? "UTC" : environment.env.TZ ?? environment.timezone;
  return { ...environment, locale, timezone };
}

/** Failed native setlocale leaves the previous locale untouched. */
export function exportLocale(environment: Environment, requested: string): Environment {
  if (requested === "") return runtimeEnvironment(environment);
  const locale = Object.hasOwn(capturedLocales, requested) ? capturedLocales[requested] : undefined;
  return locale === undefined ? environment : { ...environment, locale };
}
