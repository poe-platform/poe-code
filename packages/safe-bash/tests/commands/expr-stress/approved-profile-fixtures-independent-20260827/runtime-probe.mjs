import { pathToFileURL } from 'node:url';
const [driver, installed, serialized] = process.argv.slice(2);
const { run } = await import(pathToFileURL(driver).href);
console.log(JSON.stringify(await run({ installed, input: JSON.parse(serialized) })));
