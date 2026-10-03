import {createRequire} from "node:module";
import path from "node:path";
globalThis.require??=createRequire(path.join(process.cwd(),"package.json"));
