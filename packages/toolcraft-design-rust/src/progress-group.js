import {invokeFeedback} from "./feedback.js";
export function renderProgressGroup(items,width){return items.map(item=>invokeFeedback("progress",[item,width]));}
