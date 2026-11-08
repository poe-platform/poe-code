export interface ObjectIoQualificationBindings {
  readonly QUALIFICATION_TOKEN?: string;
  readonly QUALIFICATION_OWNER?: string;
  readonly QUALIFICATION_EXPIRES_AT?: string;
}

export function authorizeObjectIoRequest(request: Request, bindings: ObjectIoQualificationBindings, now = Date.now()): Response | undefined {
  const expires = Number(bindings.QUALIFICATION_EXPIRES_AT);
  if (typeof bindings.QUALIFICATION_TOKEN !== "string" || bindings.QUALIFICATION_TOKEN.length < 32
    || !bindings.QUALIFICATION_OWNER || bindings.QUALIFICATION_OWNER.length > 128 || !Number.isSafeInteger(expires) || expires <= 0) {
    return new Response("Qualification bindings required", { status: 503 });
  }
  if (request.headers.get("Authorization") !== `Bearer ${bindings.QUALIFICATION_TOKEN}`) return new Response("Unauthorized", { status: 401 });
  const url = new URL(request.url);
  if (expires <= now && url.pathname !== "/cleanup") return new Response("Qualification expired", { status: 410 });
  if (expires - now > 3600000) return new Response("Expiry must be within one hour", { status: 503 });
  if (request.method !== "POST") return new Response("POST required", { status: 405 });
  if (request.headers.get("Content-Length") !== "0" || request.headers.has("Transfer-Encoding")) return new Response("Empty request required", { status: 400 });
  if (!["/ready", "/cleanup", "/conformance", "/unhandled-errors", "/object-io-781"].includes(url.pathname)) return new Response("Not found", { status: 404 });
  if (url.pathname !== "/object-io-781" && url.search) return new Response("Control queries forbidden", { status: 400 });
  return undefined;
}

export interface ObjectIoCleanupBucket {
  list(options: { limit: number }): Promise<{ objects: readonly { key: string }[]; truncated: boolean }>;
  delete(keys: string[]): Promise<unknown>;
}

export async function cleanupObjectIoBucket(bucket: ObjectIoCleanupBucket, maxPages = 32): Promise<{
  removedObjects: number; listedPages: number; remainingObjects: 0; truncated: false;
}> {
  if (!Number.isSafeInteger(maxPages) || maxPages < 1 || maxPages > 32) throw new RangeError("Invalid cleanup page cap");
  let removedObjects = 0;
  for (let listedPages = 1; listedPages <= maxPages; listedPages++) {
    const page = await bucket.list({ limit: 100 });
    if (!page.objects.length) {
      if (page.truncated) throw new Error("Qualification cleanup returned a truncated empty page");
      return { removedObjects, listedPages, remainingObjects: 0, truncated: false };
    }
    await bucket.delete(page.objects.map(object => object.key));
    removedObjects += page.objects.length;
  }
  throw new Error("Qualification cleanup cap exhausted; bucket emptiness unverified");
}
