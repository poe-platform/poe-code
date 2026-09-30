/** Python source bundled as data; a host bridge must install it as poe_llm. */
const pythonLlmModule = String.raw`
"""Async Python workflows for the invocation-owned JavaScript LLM service."""
from __future__ import annotations

import asyncio
import copy
import inspect
import math
import os
from dataclasses import dataclass, field, replace
from typing import Any, AsyncIterator, Callable, Mapping, Optional, Protocol, Sequence, Union

Option = Union[str, int, float, bool, None]

class LlmError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code

class LimitError(LlmError):
    def __init__(self, message="LLM response byte limit exceeded"):
        super().__init__("limit", message)

class CapabilityError(LlmError):
    def __init__(self, message="This Python invocation has no LLM capability"):
        super().__init__("capability", message)

class Bridge(Protocol):
    async def call(self, operation: str, payload: Mapping[str, Any]) -> Any: ...
    def stream(self, payload: Mapping[str, Any]) -> AsyncIterator[Mapping[str, Any]]: ...

@dataclass(frozen=True)
class Model:
    id: str
    aliases: tuple[str, ...] = ()
    capabilities: tuple[str, ...] = ()
    metadata: Mapping[str, Any] = field(default_factory=dict)

@dataclass(frozen=True)
class Configuration:
    default_model: Optional[str] = None
    aliases: Mapping[str, str] = field(default_factory=dict)
    model_options: Mapping[str, Mapping[str, str]] = field(default_factory=dict)

@dataclass(frozen=True)
class Message:
    role: str
    content: str

@dataclass(frozen=True)
class Attachment:
    path: str
    mime_type: Optional[str] = None

    def payload(self):
        if not isinstance(self.path, str) or not self.path or "\0" in self.path:
            raise ValueError("Attachment requires an agent filesystem path")
        path = self.path if os.path.isabs(self.path) else os.path.join(os.getcwd(), self.path)
        result = {"path": path}
        if self.mime_type is not None:
            result["mimeType"] = self.mime_type
        return result

def _options(values):
    result = dict(values)
    for key, value in result.items():
        if not isinstance(key, str) or not key:
            raise TypeError("Option names must be nonempty strings")
        if value is not None and type(value) not in (str, int, float, bool):
            raise TypeError("Model options must be strings, numbers, booleans or None")
        if type(value) is int and abs(value) > 9007199254740991:
            raise ValueError("Integer model options must fit the JavaScript safe integer range")
        if type(value) is float and not math.isfinite(value):
            raise ValueError("Model options must be finite")
    return result

def _configuration_context():
    return {"cwd": os.getcwd(), "configuration_env": {
        name: os.environ.get(name) for name in ("HOME", "XDG_CONFIG_HOME", "LLM_USER_PATH")
    }}

@dataclass(frozen=True)
class Request:
    prompt: str = ""
    model: Optional[str] = None
    system: Optional[str] = None
    messages: Sequence[Message] = ()
    attachments: Sequence[Attachment] = ()
    options: Mapping[str, Option] = field(default_factory=dict)
    schema: Optional[Mapping[str, Any]] = None
    template: Optional[str] = None
    parameters: Mapping[str, Any] = field(default_factory=dict)
    conversation: Optional[str] = None

    def payload(self):
        if not isinstance(self.prompt, str):
            raise TypeError("Prompt must be a string")
        if self.model is not None and (not isinstance(self.model, str) or not self.model):
            raise TypeError("Model must be a nonempty identity or alias")
        if self.system is not None and not isinstance(self.system, str):
            raise TypeError("System prompt must be a string")
        messages = []
        for message in self.messages:
            if not isinstance(message, Message) or not isinstance(message.role, str) or not isinstance(message.content, str):
                raise TypeError("Messages must contain typed Message values")
            messages.append({"role": message.role, "content": message.content})
        result = {**_configuration_context(), "prompt": self.prompt, "messages": messages,
                  "attachments": [attachment.payload() for attachment in self.attachments],
                  "options": _options(self.options)}
        for key in ("model", "system", "schema", "template", "conversation"):
            value = getattr(self, key)
            if value is not None:
                result[key] = copy.deepcopy(value)
        if self.parameters:
            result["parameters"] = copy.deepcopy(dict(self.parameters))
        return result

def _bytes(value):
    if value is None:
        return b""
    if isinstance(value, (bytes, bytearray, memoryview)):
        return bytes(value)
    if isinstance(value, (tuple, list)) and all(type(item) is int and 0 <= item <= 255 for item in value):
        return bytes(value)
    raise LlmError("protocol", "Invalid binary LLM result")

@dataclass(frozen=True)
class Response:
    model: str
    text: str = ""
    data: bytes = b""
    usage: Mapping[str, Any] = field(default_factory=dict)
    conversation: Optional[str] = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

    @classmethod
    def from_payload(cls, value):
        if not isinstance(value, Mapping) or not isinstance(value.get("model"), str) or not isinstance(value.get("text", ""), str):
            raise LlmError("protocol", "Invalid complete LLM response")
        return cls(model=value["model"], text=value.get("text", ""), data=_bytes(value.get("data")),
                   usage=copy.deepcopy(value.get("usage", {})), conversation=value.get("conversation"),
                   metadata=copy.deepcopy(value.get("metadata", {})))

    def json(self):
        import json
        return json.loads(self.text)

@dataclass(frozen=True)
class Embeddings:
    model: str
    vectors: tuple[tuple[float, ...], ...]
    usage: Mapping[str, Any] = field(default_factory=dict)
    metadata: Mapping[str, Any] = field(default_factory=dict)

@dataclass(frozen=True)
class Event:
    type: str
    text: str = ""
    data: bytes = b""
    response: Optional[Response] = None
    metadata: Mapping[str, Any] = field(default_factory=dict)

async def _transform(function, value):
    result = function(value) if function else value
    return await result if inspect.isawaitable(result) else result

_DEFAULT_LIMIT = object()

class Stream:
    """Use async with to close the host iterator after an early break."""
    def __init__(self, client, request, timeout=None, max_response_bytes=_DEFAULT_LIMIT):
        self._client = client
        self._request = request
        self._iterator = None
        self._closed = False
        self._close_task = None
        self._pending = None
        self._lock = asyncio.Lock()
        self._bytes = 0
        self._limit = client._limit if max_response_bytes is _DEFAULT_LIMIT else _limit(max_response_bytes)
        self._timeout = client._timeout if timeout is None else _timeout(timeout)
        self._deadline = None
        self.response = None

    async def __aenter__(self):
        self._client._check_open()
        return self

    async def __aexit__(self, *exception):
        await self.aclose()

    def __aiter__(self):
        return self

    async def __anext__(self):
        async with self._lock:
            if self._closed:
                raise StopAsyncIteration
            self._client._check_open()
            try:
                if self._deadline is None and self._timeout is not None:
                    self._deadline = asyncio.get_running_loop().time() + self._timeout
                async def read():
                    if self._iterator is None:
                        payload = await self._client._payload(self._request)
                        payload["timeout"] = self._timeout
                        payload["max_response_bytes"] = self._limit
                        self._iterator = self._client._bridge.stream(payload).__aiter__()
                    return await self._iterator.__anext__()
                remaining = None if self._deadline is None else max(0, self._deadline - asyncio.get_running_loop().time())
                self._pending = asyncio.ensure_future(read())
                value = await asyncio.wait_for(self._pending, remaining)
                kind = value.get("type")
                if kind == "text":
                    if not isinstance(value.get("text"), str):
                        raise LlmError("protocol", "Invalid text stream event")
                    event = Event(kind, text=value["text"])
                elif kind == "bytes":
                    event = Event(kind, data=_bytes(value.get("data")))
                elif kind == "response":
                    self.response = Response.from_payload(value["response"])
                    _check_size(self.response, self._limit)
                    event = Event(kind, response=self.response)
                else:
                    raise LlmError("protocol", "Unknown stream event")
                self._bytes += len(event.text.encode("utf-8")) + len(event.data)
                if self._limit is not None and self._bytes > self._limit:
                    raise LimitError()
                return event
            except BaseException:
                await self.aclose()
                raise

    async def aclose(self):
        if self._close_task is None:
            self._closed = True
            async def close():
                try:
                    if self._pending is not None and not self._pending.done():
                        self._pending.cancel()
                        await asyncio.gather(self._pending, return_exceptions=True)
                    if self._iterator is not None:
                        await self._iterator.aclose()
                finally:
                    self._client._streams.discard(self)
            self._close_task = asyncio.ensure_future(close())
        await asyncio.shield(self._close_task)

def _limit(value):
    if value is None or type(value) is float and value == math.inf:
        return None
    if type(value) is not int or value < 1:
        raise ValueError("max_response_bytes must be a positive integer")
    return value

def _timeout(value):
    if value is not None and (type(value) not in (int, float) or not math.isfinite(value) or value <= 0):
        raise ValueError("timeout must be a positive number of seconds")
    return value

def _check_size(response, limit):
    if limit is not None and len(response.text.encode("utf-8")) + len(response.data) > limit:
        raise LimitError()

class Client:
    def __init__(self, *, bridge=None, model=None, options=None, system=None,
                 request_transform=None, response_transform=None,
                 max_response_bytes=None, timeout=None):
        if bridge is None:
            try:
                from _poe_llm_capability import bridge
            except ImportError as error:
                raise CapabilityError() from error
        self._bridge = bridge
        self._defaults = {"model": model, "system": system, "options": _options(options or {})}
        self._request_transform = request_transform
        self._response_transform = response_transform
        self._limit = _limit(max_response_bytes)
        self._timeout = _timeout(timeout)
        self._streams = set()
        self._tasks = set()
        self._closed = False
        self._close_task = None

    def _check_open(self):
        if self._closed:
            raise CapabilityError("LLM client has been closed")

    async def __aenter__(self):
        self._check_open()
        return self

    async def __aexit__(self, *exception):
        await self.aclose()

    async def aclose(self):
        if self._close_task is None:
            self._closed = True
            current = asyncio.current_task()
            async def close():
                pending = [task for task in self._tasks if task is not current]
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)
                results = await asyncio.gather(*(stream.aclose() for stream in tuple(self._streams)), return_exceptions=True)
                for result in results:
                    if isinstance(result, BaseException):
                        raise result
            self._close_task = asyncio.ensure_future(close())
        await asyncio.shield(self._close_task)

    def with_defaults(self, **defaults):
        self._check_open()
        values = dict(self._defaults)
        values.update(defaults)
        values["options"] = {**self._defaults["options"], **defaults.get("options", {})}
        return Client(bridge=self._bridge, request_transform=self._request_transform,
                      response_transform=self._response_transform, max_response_bytes=self._limit,
                      timeout=self._timeout, **values)

    def _request(self, prompt, values):
        if isinstance(prompt, Request):
            if values:
                raise TypeError("A Request cannot be combined with keyword fields")
            return replace(prompt, model=prompt.model if prompt.model is not None else self._defaults["model"],
                           system=prompt.system if prompt.system is not None else self._defaults["system"],
                           options={**self._defaults["options"], **prompt.options})
        fields = {**self._defaults, **values, "prompt": prompt}
        fields["options"] = {**self._defaults["options"], **values.get("options", {})}
        return Request(**fields)

    async def _payload(self, request):
        self._check_open()
        transformed = await _transform(self._request_transform, request)
        self._check_open()
        if not isinstance(transformed, Request):
            raise TypeError("Request transform must return a Request")
        return transformed.payload()

    async def _run(self, operation, timeout):
        self._check_open()
        task = asyncio.ensure_future(operation())
        self._tasks.add(task)
        try:
            return await asyncio.wait_for(task, timeout)
        finally:
            self._tasks.discard(task)

    async def configuration(self):
        value = await self._run(lambda: self._bridge.call("configuration", _configuration_context()), self._timeout)
        return Configuration(default_model=value.get("default_model"),
                             aliases=copy.deepcopy(value.get("aliases", {})),
                             model_options=copy.deepcopy(value.get("model_options", {})))

    async def models(self):
        values = await self._run(lambda: self._bridge.call("models", _configuration_context()), self._timeout)
        return tuple(Model(id=value["id"], aliases=tuple(value.get("aliases", ())),
                           capabilities=tuple(value.get("capabilities", ())),
                           metadata=copy.deepcopy(value.get("metadata", {}))) for value in values)

    async def complete(self, prompt="", *, timeout=None, max_response_bytes=_DEFAULT_LIMIT, **values):
        limit = self._limit if max_response_bytes is _DEFAULT_LIMIT else _limit(max_response_bytes)
        timeout = self._timeout if timeout is None else _timeout(timeout)
        request = self._request(prompt, values)
        async def execute():
            payload = await self._payload(request)
            payload["timeout"] = timeout
            payload["max_response_bytes"] = limit
            response = Response.from_payload(await self._bridge.call("complete", payload))
            _check_size(response, limit)
            return await _transform(self._response_transform, response)
        return await self._run(execute, timeout)

    def stream(self, prompt="", *, timeout=None, max_response_bytes=_DEFAULT_LIMIT, **values):
        self._check_open()
        stream = Stream(self, self._request(prompt, values), timeout, max_response_bytes)
        self._streams.add(stream)
        return stream

    async def embed(self, inputs, *, model=None, options=None, timeout=None):
        if isinstance(inputs, str):
            raise TypeError("Embedding inputs must be an iterable of strings")
        inputs = tuple(inputs)
        if not all(isinstance(value, str) for value in inputs):
            raise TypeError("Embedding inputs must be an iterable of strings")
        payload = {**_configuration_context(), "model": model if model is not None else self._defaults["model"], "inputs": list(inputs),
                   "options": _options({**self._defaults["options"], **(options or {})})}
        payload["timeout"] = self._timeout if timeout is None else _timeout(timeout)
        result = await self._run(lambda: self._bridge.call("embed", payload), payload["timeout"])
        vectors = tuple(tuple(vector) for vector in result["vectors"])
        if len(vectors) != len(inputs) or any(type(value) not in (int, float) or not math.isfinite(value) for vector in vectors for value in vector):
            raise LlmError("protocol", "Invalid embedding result")
        if self._limit is not None and sum(len(vector) for vector in vectors) * 8 > self._limit:
            raise LimitError()
        return Embeddings(result["model"], vectors, copy.deepcopy(result.get("usage", {})), copy.deepcopy(result.get("metadata", {})))

    def prompt(self, function, **defaults):
        async def invoke(*args, **kwargs):
            value = function(*args, **kwargs)
            value = await value if inspect.isawaitable(value) else value
            return await self.complete(value, **defaults)
        return invoke

    def conversation(self, *, system=None, messages=(), conversation=None):
        return Conversation(self, system=system, messages=messages, conversation=conversation)

class Conversation:
    """Serial turn orchestration; failed calls never append partial turns."""
    def __init__(self, client, *, system=None, messages=(), conversation=None):
        self.client = client
        self.system = system if system is not None else client._defaults["system"]
        self.messages = list(messages)
        self.id = conversation
        self._lock = asyncio.Lock()

    async def complete(self, prompt, **values):
        async with self._lock:
            response = await self.client.complete(prompt, system=self.system, messages=tuple(self.messages),
                                                  conversation=self.id, **values)
            if not isinstance(response, Response):
                raise TypeError("Conversation requires a Response-returning transform")
            self.messages.extend((Message("user", prompt), Message("assistant", response.text)))
            self.id = response.conversation or self.id
            return response
`;

/** Install only Python data/code, without exposing a host service or credentials. */
export function installPythonLlmModule(runtime: {
  readonly globals: { set(name: string, value: unknown): void; delete(name: string): unknown };
  runPython(source: string): unknown;
}): void {
  runtime.globals.set('_safe_llm_source', pythonLlmModule);
  try {
    runtime.runPython(`
import sys as _safe_llm_sys, importlib.machinery as _safe_llm_imports
class _SafeLlmLoader:
 def __init__(self, source, spec):
  self._source = source
  self._spec = spec
 def find_spec(self, fullname, path=None, target=None):
  if fullname == 'poe_llm':
   return self._spec(fullname, self, origin='poe_llm.py')
 def create_module(self, spec):
  return None
 def exec_module(self, module):
  module.__file__ = 'poe_llm.py'
  exec(compile(self._source, 'poe_llm.py', 'exec'), module.__dict__)
_safe_llm_sys.meta_path.insert(0, _SafeLlmLoader(_safe_llm_source, _safe_llm_imports.ModuleSpec))
del _SafeLlmLoader, _safe_llm_sys, _safe_llm_imports
`);
  } finally {
    runtime.globals.delete('_safe_llm_source');
  }
}
