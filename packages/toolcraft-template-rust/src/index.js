import {createRequire} from "node:module";
import {createTemplateEngine} from "./engine.js";
export {TemplateParseError} from "./engine.js";
const native=createRequire(import.meta.url)("./toolcraft-template-rust.node");
export const {renderTemplate,getTemplatePartialNames,resolveTemplatePartials}=createTemplateEngine(native);
