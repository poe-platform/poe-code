export function defineProvider(provider) {
  if (provider.auth.kind === "api-key") {
    Object.freeze(provider.auth.prompt);
  }
  Object.freeze(provider.auth);
  for (const shape of provider.apiShapes ?? []) {
    Object.freeze(shape);
  }
  if (provider.apiShapes !== undefined) {
    Object.freeze(provider.apiShapes);
  }
  if (provider.modelInput !== undefined) {
    Object.freeze(provider.modelInput);
  }
  for (const source of Object.values(provider.env ?? {})) {
    Object.freeze(source);
  }
  if (provider.env !== undefined) {
    Object.freeze(provider.env);
  }
  return Object.freeze(provider);
}
