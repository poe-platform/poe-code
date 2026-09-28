import { expect, it } from "vitest";
import { createEngine, defaultSsconvertLimits } from "../engine.js";
import { encodeText } from "../encoding/encode.js";
import { formattingLocale } from "../formatting/locale.js";
import { converterLocale, exportLocale, runtimeEnvironment } from "./runtime.js";

it.each(["en_US", "en_US.UTF-8", "en_US.utf8"])("accepts the injected English locale %s", async locale => {
  const environment = { env: { LANG: locale }, locale: "C", timezone: "UTC" };
  expect(runtimeEnvironment(environment).locale).toBe(locale === "en_US" ? "en_US" : "en_US.UTF-8");
  expect(formattingLocale(locale).decimal).toBe(".");
  expect(formattingLocale(locale).thousand).toBe(",");
  const engine = createEngine({ environment }), output: Uint8Array[] = [];
  try {
    const result = await engine.convert({ input: { kind: "stream", source: [new TextEncoder().encode("Value\n12.5\n")] },
      importType: "Gnumeric_stf:stf_csvtab", exportType: "Gnumeric_Excel:xlsx",
      destination: { kind: "stream", sink: { async write(bytes) { output.push(bytes); } } } }, { signal: new AbortController().signal });
    expect(result.exitCode).toBe(0); expect(result.diagnostics).toEqual([]); expect(output).not.toHaveLength(0);
  } finally { await engine.dispose(); }
});

// glibc 2.41 SUPPORTED assigns ISO-8859-1 to en_US and UTF-8 to en_US.UTF-8.
it.each([
  ["en_US", [0x63, 0x61, 0x66, 0xe9]],
  ["en_US.UTF-8", [0x63, 0x61, 0x66, 0xc3, 0xa9]],
  ["en_US.utf8", [0x63, 0x61, 0x66, 0xc3, 0xa9]]
] as const)("uses the declared converter charset for %s", (locale, bytes) => {
  const environment = { env: { LC_CTYPE: locale }, locale: "C", timezone: "UTC" };
  const context = { environment, limits: defaultSsconvertLimits, signal: new AbortController().signal, own() {} };
  expect([...encodeText("café", "", false, context)]).toEqual(bytes);
  // en_US and C.UTF-8 both include neutral and combining transliteration.
  expect(new TextDecoder().decode(encodeText("café", "ASCII//TRANSLIT", false, context))).toBe("cafe");
  expect(converterLocale(environment)).toBe(locale === "en_US" ? "en_US" : "en_US.UTF-8");
});

it("keeps category precedence and export locale selection separate from charset", () => {
  const environment = { env: { LANG: "en_US", LC_NUMERIC: "en_US.utf8" }, locale: "C", timezone: "UTC" };
  expect(runtimeEnvironment(environment).locale).toBe("en_US.UTF-8");
  expect(converterLocale(environment)).toBe("en_US");
  expect(exportLocale(environment, "en_US.utf8").locale).toBe("en_US.UTF-8");
  expect(runtimeEnvironment({ ...environment, env: { ...environment.env, LC_ALL: "C" } }).locale).toBe("C");
  expect(() => runtimeEnvironment({ ...environment, env: { ...environment.env, LC_TIME: "missing" } })).toThrow("uncaptured runtime locale missing");
});
