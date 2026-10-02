import {invokeInteraction} from "./interaction.js";
export function createCommandRegistry(commands) {
  const bindings=new Map(),ids=new Set();
  for(const command of commands)invokeInteraction("register",[bindings,ids,command]);
  return {
    dispatch(key){return invokeInteraction("dispatch",[bindings,key]);},
    list(){return commands.filter(command=>invokeInteraction("enabled",[command]));}
  };
}
