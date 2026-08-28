import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export const observation = { value: require('./value.cjs').value, fixtureOnly: true };
