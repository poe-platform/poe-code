import {createRequire} from 'node:module';
export const native=createRequire(import.meta.url)('./config-extends-rust.node');
