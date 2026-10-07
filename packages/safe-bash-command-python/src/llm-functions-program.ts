/** Runs inside the configured pinned interpreter. Transport and storage remain
 * invocation-owned host capabilities; no module or conversation is persisted.
 * Explicit distributions reuse native loading with host registration guards.
 * Completed task exceptions are retrieved because transport already rejects
 * outstanding calls, preventing unobserved task failures. */
export const pythonLlmFunctionsProgram = /* @__PURE__ */ (() => String.raw`
import asyncio, codecs, inspect, json
import safe_host
from _poe_llm_capability import bridge
from llm.cli import _tools_from_code, _gather_tools
from llm import ToolOutput, Tool, Toolbox, get_tools, get_plugins
from llm.models import _wrap_tools, _get_instance
from llm_safe_host import _attachment_type


def send(op, **fields):
  return safe_host.call("llm_tools", dict(op=op, **fields))


def load_definition(definition):
  if "\n" in definition or not definition.endswith(".py"):
    send("admit", size=len(definition.encode("utf-8")))
    return definition
  decoder = codecs.getincrementaldecoder("utf-8")()
  chunks = []
  try:
    with open(definition, "rb") as source:
      for chunk in iter(lambda: source.read(4096), b""):
        send("admit", size=len(chunk))
        chunks.append(decoder.decode(chunk))
      chunks.append(decoder.decode(b"", final=True))
  except FileNotFoundError:
    from click import ClickException
    raise ClickException("File not found: " + definition)
  code = "".join(chunks).replace("\r\n", "\n").replace("\r", "\n")
  return code + "\n" if "\n" not in code and code.endswith(".py") else code


def write_text(identifier, value):
  for offset in range(0, len(value), 4096):
    send("text", id=identifier, text=value[offset:offset + 4096])


def write_attachment(identifier, attachment):
  mime = _attachment_type(attachment)
  if attachment.content:
    descriptor = dict(mimeType=mime, id=attachment.id())
    handle = send("attachment", id=identifier, descriptor=descriptor)
    content = memoryview(attachment.content)
    for offset in range(0, len(content), 4096):
      send("bytes", id=identifier, attachment=handle, bytes=list(content[offset:offset + 4096]))
  elif attachment.path:
    handle = send("attachment", id=identifier, descriptor=dict(mimeType=mime, id=attachment.id()))
    with open(attachment.path, "rb") as source:
      for chunk in iter(lambda: source.read(4096), b""):
        send("bytes", id=identifier, attachment=handle, bytes=list(chunk))
  elif attachment.url:
    send("attachment", id=identifier, descriptor=dict(mimeType=mime, id=attachment.id(), url=attachment.url))
  else:
    send("attachment", id=identifier, descriptor=dict(mimeType=mime, id=attachment.id()))


async def main():
  definitions = send("definitions")
  selection = send("selection")
  names = selection.get("names", [])
  discovery = selection.get("discovery", False)
  tools = []
  try:
    requested_plugins = selection.get("plugins", [])
    if requested_plugins:
      import llm.plugins as plugin_manager
      plugin_manager.load_plugins()
      original = (plugin_manager.DEFAULT_PLUGINS, plugin_manager.LLM_LOAD_PLUGINS, plugin_manager._loaded)
      try:
        plugin_manager.DEFAULT_PLUGINS = ()
        plugin_manager.LLM_LOAD_PLUGINS = ",".join(requested_plugins)
        plugin_manager._loaded = False
        plugin_manager.load_plugins()
      finally:
        plugin_manager.DEFAULT_PLUGINS, plugin_manager.LLM_LOAD_PLUGINS, plugin_manager._loaded = original
    plugin_query = selection.get("pluginQuery")
    if plugin_query is not None:
      plugins = get_plugins(plugin_query["all"])
      hooks = set(plugin_query["hooks"])
      if hooks:
        plugins = [plugin for plugin in plugins if hooks.intersection(plugin["hooks"])]
      send("plugins", plugins=plugins)
    registered = get_tools() if discovery and not names else {}
    functions = []
    for definition in definitions:
      functions.extend(_tools_from_code(load_definition(definition)))
    if discovery:
      if names:
        registered = {tool.name: tool for tool in functions + _gather_tools(names, [])}
      else:
        for tool in functions:
          registered[tool.name] = tool
      entries = [(key, tool, None) for key, tool in registered.items()]
    else:
      entries = [(tool.name, tool, None) for tool in functions]
      for selection_index, selected in enumerate(_gather_tools(names, [])):
        entries.extend((tool.name, tool, selection_index) for tool in _wrap_tools([selected]))
    for key, tool, selection_index in entries:
      if not isinstance(tool, Tool):
        methods = []
        for method in tool.method_tools():
          methods.append(dict(name=method.name, description=method.description,
            inputSchema=method.input_schema,
            signature=str(inspect.signature(method.implementation)).replace("(self, ", "(").replace("(self)", "()")))
        send("toolbox", name=key, tools=methods)
        continue
      index = len(tools)
      tools.append(tool)
      send("register", index=index, name=tool.name, registryKey=key, description=tool.description,
        plugin=tool.plugin, selectionIndex=selection_index, inputSchema=tool.input_schema,
        signature=str(inspect.signature(tool.implementation)),
        asynchronous=inspect.iscoroutinefunction(tool.implementation))
  except Exception as error:
    send("failed", message=getattr(error, "message", str(error)))
    return
  send("ready", prepare=any(isinstance(_get_instance(tool.implementation), Toolbox) for tool in tools))
  pending = set()
  cancelled = False
  exit_error = None
  owner = asyncio.current_task()

  async def execute(command):
    nonlocal exit_error
    identifier = command["id"]
    try:
      if command.get("prepare"):
        asynchronous = command.get("asynchronous", False)
        flag = "_async_prepared" if asynchronous else "_prepared"
        instances = []
        for tool in {tool.name: tool for tool in tools}.values():
          instance = _get_instance(tool.implementation)
          if isinstance(instance, Toolbox) and not getattr(instance, flag, False):
            instances.append(instance)
        for instance in instances:
          if asynchronous:
            await instance.prepare_async()
          else:
            instance.prepare()
          setattr(instance, flag, True)
        send("done", id=identifier)
        return
      output = tools[command["tool"]].implementation(**command["arguments"])
      if inspect.isawaitable(output):
        output = await output
      attachments = []
      if isinstance(output, ToolOutput):
        attachments, output = output.attachments, output.output
      if not isinstance(output, str):
        output = json.dumps(output, default=repr)
      write_text(identifier, output)
      for attachment in attachments:
        write_attachment(identifier, attachment)
      send("done", id=identifier)
    except SystemExit as error:
      if exit_error is None:
        exit_error = error
        owner.cancel()
    except Exception as error:
      send("error", id=identifier, message=str(error))

  def completed(task):
    pending.discard(task)
    if not task.cancelled():
      task.exception()

  try:
    while True:
      command = await bridge.wait("begin", capability="llm_tools", value=dict(op="next"))
      if command is None:
        break
      if command.get("cancel"):
        cancelled = True
        break
      task = asyncio.create_task(execute(command))
      pending.add(task)
      task.add_done_callback(completed)
    if pending and not cancelled:
      await asyncio.gather(*pending)
  except asyncio.CancelledError:
    if exit_error is None:
      raise
  finally:
    for task in pending:
      task.cancel()
    if pending:
      await asyncio.gather(*pending, return_exceptions=True)
  if exit_error is not None:
    raise exit_error

try:
  asyncio.run(main())
except SystemExit:
  send("exit")
  raise
`)();
