import {invokeTextCells} from "./text-cells.js";
export function cellWidth(value,startColumn=0){return invokeTextCells("display",[value,startColumn]);}
export function fitToWidth(text,width,startColumn=0){return invokeTextCells("fit",[text,width,startColumn]);}
export function centerCells(text,width,startColumn=0){return invokeTextCells("center",[text,width,startColumn]);}
export function padEndCells(text,width,fill=" ",startColumn=0){return invokeTextCells("pad",[text,width,fill,startColumn]);}
export function splitGraphemeCells(value,startColumn=0){return invokeTextCells("split",[value,startColumn]);}
export function stripAnsi(value){return value.replace(/\u001b\[[0-9;]*m/g,"");}
