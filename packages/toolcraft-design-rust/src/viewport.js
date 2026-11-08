import {invokeInteraction} from "./interaction.js";
export function selectViewportTail(items,height,offset,renderRows) {
  return invokeInteraction("tail",[items,height,offset,renderRows]);
}
export function createViewport({capacity}) {
  invokeInteraction("viewportValidate",[capacity]);
  const state={live:new Map(),held:undefined,position:0,unseen:0};
  return {
    append(item){return invokeInteraction("viewportAppend",[state,item,capacity]);},
    scroll(delta){return invokeInteraction("viewportScroll",[state,delta]);},
    items(){return invokeInteraction("viewportItems",[state]);},
    offset(){return state.position;},unseen(){return state.unseen;},
    find(predicate){return invokeInteraction("viewportItems",[state]).findIndex(predicate);},
    follow(){return invokeInteraction("viewportFollow",[state]);}
  };
}
