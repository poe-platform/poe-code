import path from "node:path";
import {native} from "./native.js";
export function assertContainedPath(root:string,candidate:string,message:string):void {
 const relative=path.relative(path.resolve(root),path.resolve(candidate));
 if(!native.harnessPathContained(relative,path.isAbsolute(relative),path.sep.charCodeAt(0)))throw new Error(message);
}
