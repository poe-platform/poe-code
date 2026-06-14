import { DIAGNOSTIC_CODES, createDiagnostic, type Diagnostic } from "./diagnostics.js";
import type {
  ToolcraftConfig,
  ToolcraftMethodConfig,
  ToolcraftResourceConfig
} from "./config.js";
import type { OpenApiDocument } from "./generate.js";

interface ConfiguredMethod {
  configPath: string;
  method: ToolcraftMethodConfig;
}

export function diagnose(config: ToolcraftConfig, document: OpenApiDocument): Diagnostic[] {
  const configuredMethods = collectConfiguredMethods(config.resources);
  return [
    ...diagnoseDuplicateMethods(configuredMethods),
    ...diagnoseUnknownPagination(config, configuredMethods),
    ...diagnoseUnmappedEndpoints(config, document, configuredMethods)
  ];
}

function collectConfiguredMethods(
  resources: Record<string, ToolcraftResourceConfig> | undefined
): ConfiguredMethod[] {
  const methods: ConfiguredMethod[] = [];

  function visit(resource: ToolcraftResourceConfig, path: string[]): void {
    for (const [name, method] of Object.entries(resource.methods ?? {})) {
      methods.push({
        configPath: [...path, "methods", name].join("."),
        method
      });
    }

    for (const [name, child] of Object.entries(resource.subresources ?? {})) {
      visit(child, [...path, "subresources", name]);
    }
  }

  for (const [name, resource] of Object.entries(resources ?? {})) {
    visit(resource, ["resources", name]);
  }

  return methods;
}

function diagnoseDuplicateMethods(methods: readonly ConfiguredMethod[]): Diagnostic[] {
  const seen = new Map<string, ConfiguredMethod>();
  const diagnostics: Diagnostic[] = [];

  for (const method of methods) {
    const key = endpointKey(method.method.method, method.method.path);
    const existing = seen.get(key);

    if (existing === undefined) {
      seen.set(key, method);
      continue;
    }

    diagnostics.push(
      createDiagnostic({
        code: DIAGNOSTIC_CODES.duplicateMethodPath,
        severity: "error",
        location: method.configPath,
        message: `${method.configPath} and ${existing.configPath} both bind ${key}.`
      })
    );
  }

  return diagnostics;
}

function diagnoseUnknownPagination(
  config: ToolcraftConfig,
  methods: readonly ConfiguredMethod[]
): Diagnostic[] {
  const schemes = new Set(Object.keys(config.pagination ?? {}));

  return methods
    .filter((method) => method.method.pagination !== undefined && !schemes.has(method.method.pagination))
    .map((method) =>
      createDiagnostic({
        code: DIAGNOSTIC_CODES.unknownPaginationScheme,
        severity: "error",
        location: method.configPath,
        message: `${method.configPath} references undeclared pagination scheme ${JSON.stringify(method.method.pagination)}.`
      })
    );
}

function diagnoseUnmappedEndpoints(
  config: ToolcraftConfig,
  document: OpenApiDocument,
  methods: readonly ConfiguredMethod[]
): Diagnostic[] {
  if (config.resources === undefined) {
    return [];
  }

  const configured = new Set(methods.map((method) => endpointKey(method.method.method, method.method.path)));
  const unspecified = new Set((config.unspecified_endpoints ?? []).map(normalizeEndpointText));
  const diagnostics: Diagnostic[] = [];

  for (const [path, pathItem] of Object.entries(document.paths ?? {})) {
    if (pathItem === undefined) {
      continue;
    }

    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"] as const) {
      if (!Object.hasOwn(pathItem, method)) {
        continue;
      }

      const key = endpointKey(method, path);
      if (configured.has(key) || unspecified.has(key)) {
        continue;
      }

      diagnostics.push(
        createDiagnostic({
          code: DIAGNOSTIC_CODES.unmappedEndpoint,
          severity: "error",
          location: `paths.${path}.${method}`,
          message: `${method.toUpperCase()} ${path} is not listed in resources or unspecified_endpoints.`
        })
      );
    }
  }

  return diagnostics;
}

function endpointKey(method: string, path: string): string {
  return `${method.toLowerCase()} ${path}`;
}

function normalizeEndpointText(value: string): string {
  const [method, requestPath] = value.trim().split(" ");
  return `${(method ?? "").toLowerCase()} ${requestPath ?? ""}`;
}
