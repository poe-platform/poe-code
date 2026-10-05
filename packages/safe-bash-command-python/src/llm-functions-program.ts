/** Runs inside the configured pinned interpreter. Transport and storage remain
 * invocation-owned host capabilities; no module or conversation is persisted. */
export const pythonLlmFunctionsProgram = /* @__PURE__ */ (() => String.raw`
import asyncio, codecs, inspect, json
import safe_host
from _poe_llm_capability import bridge
from llm.cli import _tools_from_code
from llm import ToolOutput
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
    tools = []
    try:
        for definition in definitions:
            tools.extend(_tools_from_code(load_definition(definition)))
        for index, tool in enumerate(tools):
            send("register", index=index, name=tool.name, description=tool.description,
                 inputSchema=tool.input_schema, signature=str(inspect.signature(tool.implementation)),
                 asynchronous=inspect.iscoroutinefunction(tool.implementation))
    except Exception as error:
        send("failed", message=getattr(error, "message", str(error)))
        return
    send("ready")
    pending = set()
    cancelled = False

    async def execute(command):
        identifier = command["id"]
        try:
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
        except Exception as error:
            send("error", id=identifier, message=str(error))

    def completed(task):
        pending.discard(task)
        # Host transport failures already reject all outstanding calls. Retrieve
        # the exception so a completed task cannot leak an unobserved failure.
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
    finally:
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)

asyncio.run(main())
`)();
