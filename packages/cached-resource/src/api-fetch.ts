import type { CacheConfig } from "./types.js";

interface ApiFetchDeps {
  fetch: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
}

export async function fetchFromApi<T>(
  config: Pick<CacheConfig, "apiEndpoint" | "fetchTimeout">,
  deps?: Partial<ApiFetchDeps>,
): Promise<T> {
  validateFetchConfig(config);

  const fetchFn = deps?.fetch ?? globalThis.fetch;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), config.fetchTimeout);

  try {
    const response = await fetchFn(config.apiEndpoint, {
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return (await response.json()) as T;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Request timed out after ${config.fetchTimeout}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

export function validateFetchConfig(
  config: Pick<CacheConfig, "apiEndpoint" | "fetchTimeout">,
): void {
  if (!Number.isFinite(config.fetchTimeout) || config.fetchTimeout < 0) {
    throw new Error("fetchTimeout must be a finite non-negative number");
  }

  try {
    new URL(config.apiEndpoint);
  } catch (error) {
    throw new Error("apiEndpoint must be a valid URL", { cause: error });
  }
}
