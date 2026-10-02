import {invokeInteraction} from "./interaction.js";
export function createOverlayManager(initialFocus) {
  const stack=[];
  return {
    open(focus){return invokeInteraction("overlayOpen",[stack,focus]);},
    close(){return invokeInteraction("overlayClose",[stack]);},
    focus(){return invokeInteraction("overlayFocus",[stack,initialFocus]);},
    dispose(){return invokeInteraction("overlayDispose",[stack]);}
  };
}
