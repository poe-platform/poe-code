import {invoke} from "./prompt-policy.js";
export function getColumns(output){return invoke("getColumns",[output]);}
export function getRows(output){return invoke("getRows",[output]);}
export function wrapTextWithPrefix(output,text,prefix,startPrefix=prefix){return invoke("wrapTextWithPrefix",[output,text,prefix,startPrefix]);}
export function wrapFrame(output,frame){return invoke("wrapFrame",[output,frame]);}
