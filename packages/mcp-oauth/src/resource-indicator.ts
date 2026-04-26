export function canonicalizeResourceIndicator(value: string | URL): string {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new Error("Resource indicator must be an absolute URL");
  }
  url.hash = "";
  return url.toString();
}
