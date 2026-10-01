import { createRequire } from "node:module";

const { NativeCompiledSchema, normalizeLegacyNullability } = createRequire(import.meta.url)(
  "./toolcraft-schema-rust.node"
);
export { normalizeLegacyNullability };

function createCompiler(schema, options) {
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
  const compiled = new NativeCompiledSchema(schema, nativeOptions, (source) => {
    // Matching stays native. Rejected patterns use the caller engine's exact
    // SyntaxError wording, including lossless UTF-16 and engine version details.
    // Valid but unsupported syntax returns to the native capability diagnostic.
    new RegExp(source, "u");
  });
  const thrownValues = new WeakMap();
  const checkFormat =
    formats.size === 0
      ? undefined
      : (name, value) => {
          const validator = formats.get(name);
          try {
            return validator === undefined ? undefined : validator(value) === true;
          } catch (value) {
            const carrier = new Error("Schema format callback failed");
            thrownValues.set(carrier, value);
            throw carrier;
          }
        };
  return { compiled, checkFormat, thrownValues };
}

export function compileJsonSchema(schema, options = {}) {
  const { compiled, checkFormat, thrownValues } = createCompiler(schema, options);
  return {
    validate(value) {
      try {
        const result = compiled.validate(value, checkFormat);
        return result.ok ? { ok: true, value } : result;
      } catch (error) {
        if (thrownValues.has(error)) throw thrownValues.get(error);
        throw error;
      }
    }
  };
}

export function projectJsonSchemaProperties(schema, options = {}) {
  const { compiled, checkFormat, thrownValues } = createCompiler(structuredClone(schema), {
    ...options,
    ...(options.registry === undefined ? {} : { registry: structuredClone(options.registry) })
  });
  return compiled.properties().map(({ sources, ...metadata }) => ({
    ...metadata,
    validate(value) {
      try {
        const result = compiled.validate(value, checkFormat, sources);
        return result.ok ? { ok: true, value } : result;
      } catch (error) {
        if (thrownValues.has(error)) throw thrownValues.get(error);
        throw error;
      }
    }
  }));
}

export function formatIssues(issues) {
  return issues
    .map(
      (issue) =>
        `${issue.path.length === 0 ? "data" : `data/${issue.path.join("/")}`} ${issue.message}`
    )
    .join(", ");
}
