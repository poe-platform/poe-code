export function canonicalizeResourceIndicator(value) {
  let resource;
  try {
    resource = value instanceof URL ? new URL(value.toString()) : new URL(value);
  } catch {
    throw new Error("Resource indicator must be an absolute URL");
  }
  resource.hash = "";
  return resource.toString();
}
