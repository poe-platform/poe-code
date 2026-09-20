import {createRequire} from 'node:module';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export {TokenVerificationError} from './auth.js';
export function createProtectedResourceMetadataDocument(options){
 const input={resource:options.resource instanceof URL?options.resource.toString():options.resource,authorizationServers:options.authorizationServers.map(value=>value instanceof URL?value.toString():value)};
 for(const key of ['bearerMethodsSupported','scopesSupported'])if(options[key]!==undefined)input[key]=[...options[key]];
 return native.protectedResourceMetadata(JSON.stringify(input));
}
