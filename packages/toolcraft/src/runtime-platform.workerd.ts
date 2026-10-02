/** Stack locations are diagnostic only; Workers have no host environment. */
export function fileURLToPath(value: string): string {
  const url = new URL(value);
  if (url.protocol !== "file:" || (url.hostname && url.hostname !== "localhost")) throw new Error("Not a local file URL");
  if (url.pathname.toLowerCase().includes("%2f")) throw new Error("Encoded path separators are not file paths");
  return decodeURIComponent(url.pathname);
}
export function defaultEnvironment(): Record<string, string | undefined> { return {}; }
