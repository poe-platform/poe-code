import {documentPolicy} from "./document-host.js";
import type {ConfigDocument} from "./types.js";
export function deepMergeDocuments(base:ConfigDocument,override:ConfigDocument):ConfigDocument {
 return documentPolicy("merge",base,override);
}
