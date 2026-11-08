import {createRequire} from 'node:module';
const native=createRequire(import.meta.url)('./tiny-http-mcp-server-rust.node');
export const SSE_HEADERS={'Content-Type':'text/event-stream','Cache-Control':'no-cache',Connection:'keep-alive'};
export function formatSseEvent({data,id,event}){return native.formatHttpSseEvent(data,id,event);}
