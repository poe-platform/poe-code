/** Shared native plugin initialization; restore the caller's registry settings. */
export const pythonLlmPluginSetup=/* @__PURE__ */ (()=>String.raw`
 import llm.plugins as manager
 manager.load_plugins()
 if request['plugins']:
  original = (manager.DEFAULT_PLUGINS, manager.LLM_LOAD_PLUGINS, manager._loaded)
  try:
   manager.DEFAULT_PLUGINS = ()
   manager.LLM_LOAD_PLUGINS = ','.join(request['plugins'])
   manager._loaded = False
   manager.load_plugins()
  finally:
   manager.DEFAULT_PLUGINS, manager.LLM_LOAD_PLUGINS, manager._loaded = original
`)();
