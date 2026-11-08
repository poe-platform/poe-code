/** Compose provider-native request bodies from borrowed sources. These helpers
 * perform no model admission or transport and never dispose input leases.
 * The host accounts for the complete wire body after escaping and base64. */
export { jsonString as serializeLlmJsonString } from './json-string.js';
export { jsonValue as serializeLlmJsonValue } from './json-value.js';
export { base64Stream as encodeLlmBase64 } from './base64-stream.js';
