const pluginOptions = Symbol("resolvedPluginOptions"),
  providerOptions = Symbol("resolvedProviderOptions");
export function setResolvedPluginOptions(plugin, options) {
  plugin[pluginOptions] = options;
  return plugin;
}
export function getResolvedPluginOptions(plugin) {
  return plugin[pluginOptions];
}
export function setResolvedProviderOptions(provider, options) {
  provider[providerOptions] = options;
  return provider;
}
export function getResolvedProviderOptions(provider) {
  return provider[providerOptions];
}
