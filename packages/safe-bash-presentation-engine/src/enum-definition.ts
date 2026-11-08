import { ValueError } from "./errors.js";

export function defineEnum<const T extends Readonly<Record<string, number | string>>>(values: T) {
  type Value = T[keyof T];
  const entries = Object.entries(values)
    .filter(([, value]) => typeof value === "number")
    .map(([name, value]) => Object.freeze({ name, value: value as Value }));
  const definition = Object.assign(values, {
    metadata(value: Value) {
      const entry = entries.find((item) => item.value === value);
      if (!entry) throw new ValueError("Unknown enumeration value.");
      return entry;
    }
  });
  for (const name of Object.keys(definition)) {
    if (typeof definition[name] === "function")
      Object.defineProperty(definition, name, { enumerable: false });
  }
  return Object.freeze(definition);
}

export function defineXmlEnum<const T extends Readonly<Record<string, number | string>>>(
  values: T,
  tokens: Readonly<Record<number, string | null>>
) {
  type Value = Extract<T[keyof T], number>;
  const entries = Object.entries(values)
    .filter(([, value]) => typeof value === "number")
    .map(([name, value]) =>
      Object.freeze({ name, value: value as Value, xml_value: tokens[value as number] ?? null })
    );
  function invalid(): never {
    throw new ValueError("Unsupported enumeration conversion.");
  }
  const definition = Object.assign(values, {
    metadata(value: Value) {
      return entries.find((item) => item.value === value) ?? invalid();
    },
    from_xml(xml_value: string): Value {
      return (
        entries.find((item) => item.xml_value !== null && item.xml_value === xml_value)?.value ??
        invalid()
      );
    },
    to_xml(value: Value): string {
      return entries.find((item) => item.value === value)?.xml_value ?? invalid();
    },
    validate(value: Value): void {
      if (!entries.some((item) => item.value === value && item.xml_value !== null)) invalid();
    }
  });
  for (const name of Object.keys(definition)) {
    if (typeof definition[name] === "function")
      Object.defineProperty(definition, name, { enumerable: false });
  }
  return Object.freeze(definition);
}
