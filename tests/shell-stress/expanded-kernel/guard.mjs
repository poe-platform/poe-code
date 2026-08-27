import { register } from 'node:module';
register('./loader.mjs', { parentURL: import.meta.url, data: { audit: process.env.SEVEN_IMPORT_AUDIT } });
