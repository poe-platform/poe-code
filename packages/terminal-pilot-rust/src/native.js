import {createRequire} from 'node:module';
export const native=createRequire(import.meta.url)('./terminal-pilot-rust.node');
