import { createRequire } from "node:module";

const { NativeCompiledSchema } = createRequire(import.meta.url)("./toolcraft-schema-rust.node");

export function compileJsonSchema(schema, options = {}) {
  const prototype = Object.getPrototypeOf(options);
  if (prototype !== null && prototype !== Object.prototype) {
    throw new Error("JSON objects must have a plain prototype");
  }
  const descriptors = Object.getOwnPropertyDescriptors(options);
  for (const descriptor of Object.values(descriptors)) {
    if (!Object.hasOwn(descriptor, "value"))
      throw new Error("JSON properties must be data properties");
  }
  const formats = new Map();
  const registrations = descriptors.formats?.value;
  if (registrations !== undefined && registrations !== null) {
    for (const [name, descriptor] of Object.entries(
      Object.getOwnPropertyDescriptors(registrations)
    )) {
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, "value"))
        throw new Error("JSON properties must be data properties");
      if (typeof descriptor.value !== "function")
        throw new Error("Format validator must be a function: " + name);
      formats.set(name, descriptor.value);
    }
  }
  const nativeOptions = Object.create(null);
  for (const [name, descriptor] of Object.entries(descriptors)) {
    if (name !== "formats") Object.defineProperty(nativeOptions, name, descriptor);
  }
  const compiled = new NativeCompiledSchema(schema, nativeOptions);
  const checkFormat =
    formats.size === 0
      ? undefined
      : (name, value) => {
          const validator = formats.get(name);
          return validator === undefined ? undefined : validator(value) === true;
        };
  return {
    validate(value) {
      const result = compiled.validate(value, checkFormat);
      return result.ok ? { ok: true, value } : result;
    }
  };
}

export function formatIssues(issues) {
  return issues
    .map(
      (issue) =>
        `${issue.path.length === 0 ? "data" : `data/${issue.path.join("/")}`} ${issue.message}`
    )
    .join(", ");
}
