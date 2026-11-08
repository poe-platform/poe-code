import { WkhtmltopdfError } from "./errors.js";

export interface ConversionCompletion {
  readonly mode: "single" | "batch";
  readonly success: boolean;
  /** Source loader code: HTTP status, or 1000 + QNetworkReply enum value. */
  readonly errorCode: number;
  /** Explicit profile data, never inferred from an ambient Qt installation. */
  readonly networkErrorName?: string;
}

export type ConversionDiagnostic =
  | { readonly kind: "http"; readonly code: number; readonly description: string }
  | { readonly kind: "network"; readonly code: number; readonly name: string | null }
  | { readonly kind: "unknown" };

export interface ConversionOutcome {
  readonly exitCode: 0 | 1 | 2 | 3;
  readonly diagnostic: ConversionDiagnostic | null;
}

const httpDescriptions: Readonly<Record<number, string>> = {
  400: "Bad Request", 401: "Unauthorized", 402: "Payment Required",
  403: "Forbidden", 404: "Page not found", 405: "Method Not Allowed",
  500: "Internal Server Error", 501: "Not Implemented",
  503: "Service Unavailable", 505: "HTTP Version Not Supported",
};

/** Pure source-defined status mapping; no renderer or native profile qualification. */
export function conversionOutcome(completion: ConversionCompletion): ConversionOutcome {
  const { mode, success, errorCode, networkErrorName } = completion;
  if ((mode !== "single" && mode !== "batch") || typeof success !== "boolean" ||
      !Number.isInteger(errorCode) || errorCode < 0 || errorCode > 2147483647) {
    throw new WkhtmltopdfError("INVALID_VALUE", "Expected a conversion mode, boolean success and nonnegative int32 loader code");
  }
  if (networkErrorName !== undefined) {
    if (typeof networkErrorName !== "string" || !networkErrorName.length || networkErrorName.length > 128) {
      throw new WkhtmltopdfError("INVALID_VALUE", "Network enum name must contain 1–128 ASCII identifier characters");
    }
    for (const character of networkErrorName) {
      if (!(character >= "a" && character <= "z") && !(character >= "A" && character <= "Z") &&
          !(character >= "0" && character <= "9") && character !== "_") {
        throw new WkhtmltopdfError("INVALID_VALUE", "Network enum name must contain ASCII identifier characters");
      }
    }
  }
  if (mode === "batch") return { exitCode: success ? 0 : 1, diagnostic: null };
  if (errorCode >= 1000) {
    return { exitCode: 1, diagnostic: { kind: "network", code: errorCode - 1000, name: networkErrorName ?? null } };
  }
  if (errorCode !== 0) {
    return {
      exitCode: errorCode === 404 ? 2 : errorCode === 401 ? 3 : 1,
      diagnostic: { kind: "http", code: errorCode, description: httpDescriptions[errorCode] ?? "" },
    };
  }
  return { exitCode: success ? 0 : 1, diagnostic: success ? null : { kind: "unknown" } };
}
