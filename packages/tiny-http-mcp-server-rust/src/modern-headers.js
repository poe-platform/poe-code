import {createRequire} from 'node:module';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export function validateModernHeaders(headers,request){return native.validateModernHeaders(JSON.stringify(headers),JSON.stringify(request))??undefined;}
