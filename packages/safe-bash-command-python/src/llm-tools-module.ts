/** Python tools stay in the guest; provider transport remains host-owned. */
export const pythonLlmToolsModule = /* @__PURE__ */ (() => String.raw`
import hashlib as _hashlib
import json as _json
from typing import get_type_hints as _get_type_hints
from types import MethodType as _MethodType


def _tool_schema(schema):
    if isinstance(schema, type) and issubclass(schema, BaseModel):
        schema = schema.model_json_schema()
        def remove_titles(value):
            if isinstance(value, dict):
                value.pop("title", None)
                for child in value.values():
                    remove_titles(child)
            elif isinstance(value, list):
                for child in value:
                    remove_titles(child)
        remove_titles(schema)
    return schema


@dataclass
class Tool:
    name: str
    description: object = None
    input_schema: dict = field(default_factory=dict)
    implementation: object = None
    plugin: object = None

    def __post_init__(self):
        self.input_schema = _tool_schema(self.input_schema)

    def hash(self):
        value = dict(name=self.name, description=self.description, input_schema=self.input_schema)
        if self.plugin:
            value["plugin"] = self.plugin
        return _hashlib.sha256(_json.dumps(value).encode("utf-8")).hexdigest()

    @classmethod
    def function(cls, function, name=None, description=None):
        if not name and function.__name__ == "<lambda>":
            raise ValueError("Cannot create a Tool from a lambda function without providing name=")
        hints = _get_type_hints(function)
        fields = {
            key: (hints.get(key, str), ... if param.default is inspect.Parameter.empty else param.default)
            for key, param in inspect.signature(function).parameters.items() if key != "self"
        }
        return cls(name or function.__name__, description or function.__doc__ or None,
                   create_model(str(name) + "InputSchema", **fields), function)


class Toolbox:
    name = None
    instance_id = None
    _blocked = ("tools", "add_tool", "method_tools", "__init_subclass__", "prepare", "prepare_async")
    _extra_tools = []
    _config = {}
    _prepared = False
    _async_prepared = False

    def __init_subclass__(cls, **kwargs):
        super().__init_subclass__(**kwargs)
        original = cls.__init__
        def initialize(self, *args, **kwargs):
            signature = inspect.signature(original)
            bound = signature.bind(self, *args, **kwargs)
            bound.apply_defaults()
            self._config = {
                name: value for name, value in bound.arguments.items()
                if name != "self" and signature.parameters[name].kind not in
                (inspect.Parameter.VAR_POSITIONAL, inspect.Parameter.VAR_KEYWORD)
            }
            self._extra_tools = []
            original(self, *args, **kwargs)
        cls.__init__ = initialize

    @classmethod
    def method_tools(cls):
        return [Tool.function(getattr(cls, name), name=cls.__name__ + "_" + name)
                for name in dir(cls) if not name.startswith("_") and name not in cls._blocked
                and callable(getattr(cls, name))]

    def tools(self):
        for name in dir(self):
            if name.startswith("_") or name in self._blocked:
                continue
            method = getattr(self, name)
            if callable(method):
                tool = Tool.function(method, name=type(self).__name__ + "_" + name)
                tool.plugin = getattr(self, "plugin", None)
                yield tool
        yield from self._extra_tools

    def add_tool(self, tool_or_function, pass_self=False):
        if isinstance(tool_or_function, Tool):
            self._extra_tools.append(tool_or_function)
        elif callable(tool_or_function):
            function = _MethodType(tool_or_function, self) if pass_self else tool_or_function
            self._extra_tools.append(Tool.function(function))
        else:
            raise ValueError("Tool must be an instance of Tool or a callable function")

    def prepare(self):
        pass

    async def prepare_async(self):
        pass


@dataclass
class ToolCall:
    name: str
    arguments: dict
    tool_call_id: object = None


@dataclass
class ToolResult:
    name: str
    output: str
    attachments: list = field(default_factory=list)
    tool_call_id: object = None
    instance: object = None
    exception: object = None


@dataclass
class ToolOutput:
    output: object = None
    attachments: list = field(default_factory=list)


class CancelToolCall(Exception):
    pass


def _wrap_tools(tools):
    result = []
    for tool in tools:
        if isinstance(tool, Tool):
            result.append(tool)
        elif isinstance(tool, Toolbox):
            result.extend(tool.tools())
        elif callable(tool):
            result.append(Tool.function(tool))
        else:
            raise ValueError("Invalid tool: " + str(tool))
    return result


async def _execute_tool_calls(response, asynchronous, before_call, after_call):
    if asynchronous:
        calls = await response.tool_calls()
    tools = {tool.name: tool for tool in response.prompt.tools}
    for tool in tools.values():
        instance = getattr(tool.implementation, "__self__", None)
        flag = "_async_prepared" if asynchronous else "_prepared"
        if isinstance(instance, Toolbox) and not getattr(instance, flag, False):
            if asynchronous:
                await instance.prepare_async()
            else:
                instance.prepare()
            setattr(instance, flag, True)

    if not asynchronous:
        while not response._done:
            try:
                await response._next()
            except StopAsyncIteration:
                break
        calls = response._tool_calls

    async def callback(function, name, *args):
        value = function(*args)
        if inspect.isawaitable(value):
            if not asynchronous:
                close = getattr(value, "close", None)
                if close:
                    close()
                raise TypeError("Asynchronous '" + name + "' callback provided to a synchronous tool execution context. "
                                "Please use an async chain/response or a synchronous callback.")
            await value

    async def run(call, tool):
        if before_call:
            try:
                await callback(before_call, "before_call", tool, call)
            except CancelToolCall as error:
                return ToolResult(call.name, "Cancelled: " + str(error),
                                  tool_call_id=call.tool_call_id, exception=error)
        if tool is None:
            message = 'tool "' + call.name + '" does not exist'
            return ToolResult(call.name, "Error: " + message,
                              tool_call_id=call.tool_call_id, exception=KeyError(message))
        if not tool.implementation:
            raise ValueError("No implementation available for tool: " + call.name)
        attachments = []
        exception = None
        try:
            output = tool.implementation(**call.arguments)
            if inspect.isawaitable(output):
                output = await output
            if isinstance(output, ToolOutput):
                attachments = output.attachments
                output = output.output
            if not isinstance(output, str):
                output = _json.dumps(output, default=repr)
        except Exception as error:
            output = "Error: " + str(error)
            exception = error
        result = ToolResult(call.name, output, attachments, call.tool_call_id,
                            getattr(tool.implementation, "__self__", None), exception)
        if after_call:
            await callback(after_call, "after_call", tool, call, result)
        return result

    results = [None] * len(calls)
    pending = []
    async def store(index, call, tool):
        results[index] = await run(call, tool)
    try:
        for index, call in enumerate(calls):
            tool = tools.get(call.name)
            if asynchronous and tool is not None and inspect.iscoroutinefunction(tool.implementation):
                pending.append(asyncio.create_task(store(index, call, tool)))
            else:
                results[index] = await run(call, tool)
        if pending:
            await asyncio.gather(*pending)
        return results
    finally:
        for task in pending:
            if not task.done():
                task.cancel()
        if pending:
            await asyncio.gather(*pending, return_exceptions=True)


class _BaseChainResponse:
    def __init__(self, prompt, model, stream, conversation, key=None, chain_limit=10,
                 before_call=None, after_call=None):
        self.prompt = prompt
        self.model = model
        self.stream = stream
        self.conversation = conversation
        self._key = key
        self.chain_limit = chain_limit
        self.before_call = before_call
        self.after_call = after_call
        self._responses = []

    def _followup(self, response, results):
        return Prompt("", self.model, tools=response.prompt.tools, tool_results=results,
                      options=self.prompt.options,
                      attachments=[attachment for result in results for attachment in result.attachments])


class ChainResponse(_BaseChainResponse):
    def responses(self):
        prompt = self.prompt
        count = 0
        while True:
            response = Response(prompt, self.model, self.stream, self.conversation, self._key)
            try:
                count += 1
                yield response
                self._responses.append(response)
                if self.chain_limit and count >= self.chain_limit:
                    raise ValueError("Chain limit of " + str(self.chain_limit) + " exceeded.")
                results = response.execute_tool_calls(before_call=self.before_call, after_call=self.after_call)
                if not results:
                    return
                prompt = self._followup(response, results)
            finally:
                if not response._done:
                    response.close()

    def __iter__(self):
        responses = self.responses()
        try:
            for response in responses:
                yield from response
        finally:
            responses.close()

    def text(self):
        return "".join(self)


class AsyncChainResponse(_BaseChainResponse):
    async def responses(self):
        prompt = self.prompt
        count = 0
        while True:
            response = AsyncResponse(prompt, self.model, self.stream, self.conversation, self._key)
            try:
                count += 1
                yield response
                self._responses.append(response)
                if self.chain_limit and count >= self.chain_limit:
                    raise ValueError("Chain limit of " + str(self.chain_limit) + " exceeded.")
                results = await response.execute_tool_calls(before_call=self.before_call, after_call=self.after_call)
                if not results:
                    return
                prompt = self._followup(response, results)
            finally:
                if not response._done:
                    await response.aclose()

    async def __aiter__(self):
        responses = self.responses()
        try:
            async for response in responses:
                async for chunk in response:
                    yield chunk
        finally:
            await responses.aclose()

    async def text(self):
        return "".join([chunk async for chunk in self])
`)();
