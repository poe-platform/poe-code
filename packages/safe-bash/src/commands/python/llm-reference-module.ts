import { pythonLlmToolsModule } from "./llm-tools-module.js";

/** Public Python calling conventions over the invocation-owned internal client. */
export const pythonLlmReferenceModule = /* @__PURE__ */ (() => String.raw`
"""Lazy synchronous and asynchronous model responses backed by JavaScript."""
import asyncio
import inspect
import datetime as _datetime
from dataclasses import dataclass, field
import os
import time
from pydantic import BaseModel, ConfigDict, Field, create_model
import poe_llm as _core

Error = _core.LlmError


class Options(BaseModel):
    model_config = ConfigDict(extra="forbid")


def _sync(awaitable):
    try:
        from pyodide.ffi import run_sync
    except ImportError:
        # The native path is for capability tests; production suspension is JSPI.
        try:
            asyncio.get_running_loop()
        except RuntimeError:
            global _native_loop
            if _native_loop is None or _native_loop.is_closed():
                _native_loop = asyncio.new_event_loop()
            return _native_loop.run_until_complete(awaitable)
        awaitable.close()
        raise RuntimeError("Use the asynchronous model API inside an asyncio event loop")
    return run_sync(awaitable)


_native_loop = None


@dataclass
class Usage:
    input: object = None
    output: object = None
    details: object = None


@dataclass
class Attachment:
    type: object = None
    path: object = None
    url: object = None
    content: object = None
    _id: object = None

    def payload(self):
        if self.content is not None:
            if not isinstance(self.content, bytes):
                raise TypeError("Attachment content must be bytes")
            return {"content": list(self.content), "mimeType": self.resolve_type()}
        if self.url is not None:
            raise NotImplementedError("URL attachment acquisition requires shared service support")
        return _core.Attachment(os.fspath(self.path), self.type).payload()

    def id(self):
        import hashlib
        import json
        if self._id is None:
            digest = hashlib.sha256()
            if self.content:
                digest.update(self.content)
            elif self.path:
                with open(self.path, "rb") as source:
                    for chunk in iter(lambda: source.read(65536), b""):
                        digest.update(chunk)
            else:
                digest.update(json.dumps({"url": self.url}).encode("utf-8"))
            self._id = digest.hexdigest()
        return self._id

    def content_bytes(self):
        if self.content:
            return self.content
        if self.path:
            with open(self.path, "rb") as source:
                return source.read()
        if self.url:
            raise NotImplementedError("URL attachment acquisition requires shared service support")
        return self.content

    def base64_content(self):
        import base64
        return base64.b64encode(self.content_bytes()).decode("utf-8")

    def resolve_type(self):
        if self.type:
            return self.type
        if self.path:
            with open(self.path, "rb") as source:
                prefix = source.read(4096)
        elif self.content:
            prefix = self.content[:4096]
        elif self.url:
            raise NotImplementedError("URL attachment acquisition requires shared service support")
        else:
            raise ValueError("Attachment has no type and no content to derive it from")
        async def resolve():
            async with _core.Client() as client:
                payload = {"path": os.fspath(self.path) if self.path else "", "prefix": list(prefix)}
                return await client._run(lambda: client._bridge.call("attachment_type", payload), client._timeout)
        return _sync(resolve())

    @classmethod
    def from_row(cls, row):
        return cls(_id=row["id"], type=row["type"], path=row["path"], url=row["url"], content=row["content"])


${pythonLlmToolsModule}


class Prompt:
    def __init__(self, prompt, model, *, fragments=None, attachments=None,
                 system=None, system_fragments=None, prompt_json=None,
                 options=None, schema=None, tools=None, tool_results=None):
        self._prompt = prompt
        self.model = model
        self.fragments = fragments or []
        self._system = system
        self.system_fragments = system_fragments or []
        self.prompt_json = prompt_json
        self.attachments = list(attachments or [])
        if schema is not None and hasattr(schema, "model_json_schema"):
            schema = schema.model_json_schema()
        self.schema = schema
        self.options = options or {}
        self.tools = _wrap_tools(tools or [])
        self.tool_results = tool_results or []

    @property
    def prompt(self):
        return "\n".join(self.fragments + ([self._prompt] if self._prompt else []))

    @property
    def system(self):
        bits = [bit.strip() for bit in self.system_fragments + [self._system or ""] if bit.strip()]
        return "\n\n".join(bits)


_last_id = 0


def _new_id():
    global _last_id
    _last_id = max((int(time.time() * 1000) << 80) | int.from_bytes(os.urandom(10), "big"), _last_id + 1)
    alphabet = "0123456789abcdefghjkmnpqrstvwxyz"
    return "".join(alphabet[(_last_id >> shift) & 31] for shift in range(125, -1, -5))


class _Response:
    def __init__(self, prompt, model, stream, conversation=None, key=None):
        if prompt.schema and not model.supports_schema:
            raise ValueError(str(model) + " does not support schemas")
        if prompt.tools and not model.supports_tools:
            raise ValueError(str(model) + " does not support tools")
        self.id = _new_id()
        self.prompt = prompt
        self.model = model
        self.stream = stream
        self.conversation = conversation
        self._key = key
        self._chunks = []
        self._done = False
        self._closed = False
        self._client = None
        self._iterator = None
        self._custom_iterator = None
        self.response_json = None
        self.input_tokens = None
        self.output_tokens = None
        self.token_details = None
        self.done_callbacks = []
        self.resolved_model = None
        self.attachments = []
        self._tool_calls = []
        self._prompt_json = None
        self._start = None
        self._end = None
        self._start_utcnow = None

    def add_tool_call(self, tool_call):
        self._tool_calls.append(tool_call)

    def set_usage(self, *, input=None, output=None, details=None):
        self.input_tokens = input
        self.output_tokens = output
        self.token_details = details

    def set_resolved_model(self, model_id):
        self.resolved_model = model_id

    def token_usage(self):
        import json
        parts = []
        if self.input_tokens is not None:
            parts.append(format(self.input_tokens, ",") + " input")
        if self.output_tokens is not None:
            parts.append(format(self.output_tokens, ",") + " output")
        if self.token_details:
            parts.append(json.dumps(self.token_details))
        return ", ".join(parts)

    async def _finish(self):
        self._end = time.monotonic()
        self._done = True
        if self.conversation is not None:
            self.conversation.responses.append(self)
        await self._close()
        callbacks, self.done_callbacks = self.done_callbacks, []
        for callback in callbacks:
            value = callback(self)
            if inspect.isawaitable(value):
                await value

    async def _close(self):
        if self._custom_iterator is not None:
            iterator, self._custom_iterator = self._custom_iterator, None
            close = getattr(iterator, "aclose", None) or getattr(iterator, "close", None)
            if close is not None:
                result = close()
                if inspect.isawaitable(result):
                    await result
        if self._client is not None:
            await self._client.aclose()

    def _metadata(self, response):
        # json() returns provider response metadata, not parsed generated text.
        self.response_json = response.metadata.get("response_json")
        self.input_tokens = response.usage.get("input_tokens")
        self.output_tokens = response.usage.get("output_tokens")
        self.token_details = response.usage.get("details")

    async def _next(self):
        if self._done or self._closed:
            raise StopAsyncIteration
        try:
            execute = getattr(self.model, "execute", None)
            if execute is not None:
                if self._custom_iterator is None:
                    self._start = time.monotonic()
                    self._start_utcnow = _datetime.datetime.now(_datetime.timezone.utc)
                    self._custom_iterator = execute(self.prompt, self.stream, self, self.conversation)
                try:
                    if isinstance(self.model, AsyncModel):
                        chunk = await self._custom_iterator.__anext__()
                    else:
                        chunk = next(self._custom_iterator)
                except (StopIteration, StopAsyncIteration):
                    await self._finish()
                    raise StopAsyncIteration
                self._chunks.append(chunk)
                return chunk
            if self.prompt.tools or self.prompt.tool_results:
                raise NotImplementedError("Tools require shared service support")
            if self._client is None:
                self._start = time.monotonic()
                self._start_utcnow = _datetime.datetime.now(_datetime.timezone.utc)
                self._client = _core.Client(model=self.model.model_id, key=self._key)
                options = self.prompt.options
                if hasattr(options, "model_dump"):
                    options = options.model_dump(exclude_none=True)
                values = dict(system=self.prompt.system, options=options,
                              attachments=self.prompt.attachments, schema=self.prompt.schema)
                if self.conversation is not None:
                    messages = []
                    for response in self.conversation.responses:
                        if response.prompt.system:
                            messages.append(_core.Message("system", response.prompt.system))
                        messages.extend((_core.Message("user", response.prompt.prompt or ""),
                                         _core.Message("assistant", "".join(response._chunks))))
                    values.update(messages=messages)
                if not self.stream:
                    response = await self._client.complete(self.prompt.prompt or "", **values)
                    self._metadata(response)
                    self._chunks.append(response.text)
                    await self._finish()
                    return response.text
                self._iterator = self._client.stream(self.prompt.prompt or "", **values)
            while True:
                try:
                    event = await self._iterator.__anext__()
                except StopAsyncIteration:
                    await self._finish()
                    raise
                if event.type == "response":
                    self._metadata(event.response)
                elif event.type == "text":
                    self._chunks.append(event.text)
                    return event.text
        except BaseException:
            await self._close()
            raise


class Response(_Response):
    def tool_calls(self):
        self.text()
        return self._tool_calls

    def tool_calls_or_raise(self):
        self.text()
        return self._tool_calls

    def execute_tool_calls(self, *, before_call=None, after_call=None):
        return _sync(_execute_tool_calls(self, False, before_call, after_call))

    def __str__(self):
        return self.text()

    def text_or_raise(self):
        return self.text()

    def duration_ms(self):
        self.text()
        return int(((self._end or 0) - (self._start or 0)) * 1000)

    def datetime_utc(self):
        self.text()
        return self._start_utcnow.isoformat() if self._start_utcnow else ""

    def __iter__(self):
        if self._done:
            yield from self._chunks
            return
        try:
            while True:
                try:
                    chunk = _sync(self._next())
                except StopAsyncIteration:
                    return
                yield chunk
        finally:
            if not self._done:
                self.close()

    def text(self):
        if not self._done:
            for _ in self:
                pass
        return "".join(self._chunks)

    def json(self):
        self.text()
        return self.response_json

    def usage(self):
        self.text()
        return Usage(self.input_tokens, self.output_tokens, self.token_details)

    def on_done(self, callback):
        if self._done:
            callback(self)
        else:
            self.done_callbacks.append(callback)

    def close(self):
        self._closed = True
        _sync(self._close())


class AsyncResponse(_Response):
    async def tool_calls(self):
        await self.text()
        return self._tool_calls

    def tool_calls_or_raise(self):
        if not self._done:
            raise ValueError("Response not yet awaited")
        return self._tool_calls

    async def execute_tool_calls(self, *, before_call=None, after_call=None):
        return await _execute_tool_calls(self, True, before_call, after_call)

    def __await__(self):
        async def complete():
            await self.text()
            return self
        return complete().__await__()

    def text_or_raise(self):
        if not self._done:
            raise ValueError("Response not yet awaited")
        return "".join(self._chunks)

    async def duration_ms(self):
        await self.text()
        return int(((self._end or 0) - (self._start or 0)) * 1000)

    async def datetime_utc(self):
        await self.text()
        return self._start_utcnow.isoformat() if self._start_utcnow else ""

    async def to_sync_response(self):
        await self.text()
        conversation = self.conversation.to_sync_conversation() if self.conversation else None
        response = Response(self.prompt, self.model, self.stream, conversation=conversation)
        for name in ("id", "_done", "_end", "_start", "_start_utcnow", "input_tokens",
                     "output_tokens", "token_details", "_prompt_json", "response_json", "resolved_model"):
            setattr(response, name, getattr(self, name))
        response._chunks = list(self._chunks)
        response._tool_calls = list(self._tool_calls)
        response.attachments = list(self.attachments)
        return response

    def __aiter__(self):
        if self._done:
            self._replay = iter(self._chunks)
        return self

    async def __anext__(self):
        if self._done:
            try:
                return next(getattr(self, "_replay", iter(())))
            except StopIteration:
                raise StopAsyncIteration from None
        return await self._next()

    async def text(self):
        if not self._done:
            async for _ in self:
                pass
        return "".join(self._chunks)

    async def json(self):
        await self.text()
        return self.response_json

    async def usage(self):
        await self.text()
        return Usage(self.input_tokens, self.output_tokens, self.token_details)

    async def on_done(self, callback):
        if self._done:
            value = callback(self)
            if inspect.isawaitable(value):
                await value
        else:
            self.done_callbacks.append(callback)

    async def aclose(self):
        self._closed = True
        await self._close()


class Model:
    class Options(Options):
        pass
    supports_schema = False
    supports_tools = False
    attachment_types = set()

    def __init__(self, model_id=None, *, capabilities=None, metadata=None):
        if model_id is not None:
            self.model_id = model_id
        if capabilities is not None:
            self.supports_schema = "schema" in capabilities
        if metadata is not None:
            self.attachment_types = set(metadata.get("attachmentTypes", ()))
            if "options" not in metadata:
                self.Options = create_model("Options", __base__=type(self).Options, __config__=ConfigDict(extra="allow"))
            else:
                from typing import Optional
                types = {"number": float, "integer": int, "boolean": bool, "string": str}
                fields = {}
                for name, declaration in metadata["options"].items():
                    value_type = types[declaration["type"]]
                    if declaration.get("nullable"):
                        value_type = Optional[value_type]
                    constraints = {}
                    for source, target in (("minimum", "ge"), ("maximum", "le"), ("description", "description")):
                        if source in declaration:
                            constraints[target] = declaration[source]
                    fields[name] = (value_type, Field(default=None, **constraints))
                self.Options = create_model("Options", __base__=type(self).Options, **fields)

    def __str__(self):
        suffix = " (async)" if isinstance(self, AsyncModel) else ""
        return self.__class__.__name__ + suffix + ": " + self.model_id

    def __repr__(self):
        return "<" + str(self) + ">"

    def _validate_attachments(self, attachments=None):
        if attachments and not self.attachment_types:
            raise ValueError("This model does not support attachments")
        for attachment in attachments or []:
            attachment_type = attachment.resolve_type()
            if attachment_type not in self.attachment_types:
                raise ValueError(
                    "This model does not support attachments of type '" + attachment_type
                    + "', only " + ", ".join(self.attachment_types)
                )

    def prompt(self, prompt=None, *, fragments=None, attachments=None, system=None,
               system_fragments=None, stream=True, schema=None, tools=None,
               tool_results=None, **options):
        self._validate_attachments(attachments)
        key = options.pop("key", None)
        options = self.Options(**options)
        if schema is not None and hasattr(schema, "model_json_schema"):
            schema = schema.model_json_schema()
        return Response(Prompt(prompt, self, system=system, attachments=attachments,
                               fragments=fragments, system_fragments=system_fragments,
                               tools=tools, tool_results=tool_results,
                               schema=schema, options=options), self, stream, key=key)


    def chain(self, prompt=None, *, fragments=None, attachments=None, system=None,
              system_fragments=None, stream=True, schema=None, tools=None,
              tool_results=None, before_call=None, after_call=None, key=None, options=None):
        conversation = self.conversation(tools=tools, before_call=before_call, after_call=after_call)
        return conversation.chain(prompt, fragments=fragments, attachments=attachments,
                                  system=system, system_fragments=system_fragments, stream=stream,
                                  schema=schema, tool_results=tool_results, key=key, options=options)

    def conversation(self, tools=None, before_call=None, after_call=None, chain_limit=None):
        return Conversation(self, tools=tools, before_call=before_call, after_call=after_call, chain_limit=chain_limit)


class AsyncModel(Model):
    def prompt(self, prompt=None, *, fragments=None, attachments=None, system=None,
               schema=None, tools=None, tool_results=None, system_fragments=None,
               stream=True, **options):
        response = super().prompt(prompt, fragments=fragments, attachments=attachments,
                                  system=system, schema=schema, tools=tools,
                                  tool_results=tool_results, system_fragments=system_fragments,
                                  stream=stream, **options)
        return AsyncResponse(response.prompt, self, stream, key=response._key)


    def conversation(self, tools=None, before_call=None, after_call=None, chain_limit=None):
        return AsyncConversation(self, tools=tools, before_call=before_call, after_call=after_call, chain_limit=chain_limit)


@dataclass
class Conversation:
    model: object
    id: str = field(default_factory=_new_id)
    name: object = None
    responses: list = field(default_factory=list)
    tools: object = None
    chain_limit: object = None
    before_call: object = None
    after_call: object = None

    def prompt(self, prompt=None, *, fragments=None, attachments=None, system=None,
               schema=None, tools=None, tool_results=None, system_fragments=None,
               stream=True, key=None, **options):
        response = self.model.prompt(prompt, fragments=fragments, attachments=attachments,
                                     system=system, schema=schema, tools=tools or self.tools,
                                     tool_results=tool_results, system_fragments=system_fragments,
                                     stream=stream, key=key, **options)
        response.conversation = self
        return response

    def chain(self, prompt=None, *, fragments=None, attachments=None, system=None,
              system_fragments=None, stream=True, schema=None, tools=None, tool_results=None,
              chain_limit=None, before_call=None, after_call=None, key=None, options=None):
        self.model._validate_attachments(attachments)
        value = Prompt(prompt, self.model, fragments=fragments, attachments=attachments,
                       system=system, system_fragments=system_fragments, schema=schema,
                       tools=tools or self.tools, tool_results=tool_results,
                       options=self.model.Options(**(options or {})))
        response_type = AsyncChainResponse if isinstance(self, AsyncConversation) else ChainResponse
        return response_type(value, self.model, stream, self, key,
                             chain_limit if chain_limit is not None else self.chain_limit,
                             before_call or self.before_call, after_call or self.after_call)


class AsyncConversation(Conversation):
    def to_sync_conversation(self):
        return Conversation(model=self.model, id=self.id, name=self.name, responses=[],
                            tools=self.tools, chain_limit=self.chain_limit)


class UnknownModelError(KeyError):
    pass


async def _models():
    async with _core.Client() as client:
        return await client.models()


@dataclass
class ModelWithAliases:
    model: object
    async_model: object
    aliases: object

    def matches(self, query):
        strings = list(self.aliases)
        if self.model:
            strings.append(str(self.model))
        if self.async_model:
            strings.append(str(self.async_model.model_id))
        return any(query.lower() in value.lower() for value in strings)


@dataclass
class EmbeddingModelWithAliases:
    model: object
    aliases: object

    def matches(self, query):
        return any(query.lower() in value.lower() for value in [*self.aliases, str(self.model)])


def get_models_with_aliases():
    return [
        ModelWithAliases(
            Model(item.id, capabilities=item.capabilities, metadata=item.metadata),
            AsyncModel(item.id, capabilities=item.capabilities, metadata=item.metadata),
            list(item.aliases))
        for item in _sync(_models())
    ]


def get_models():
    return [item.model for item in get_models_with_aliases() if item.model]


def get_async_models():
    return [item.async_model for item in get_models_with_aliases() if item.async_model]


def get_model_aliases():
    result = {}
    for item in get_models_with_aliases():
        if item.model:
            for name in (*item.aliases, item.model.model_id):
                result[name] = item.model
    return result


def get_async_model_aliases():
    result = {}
    for item in get_models_with_aliases():
        if item.async_model:
            for name in (*item.aliases, item.model.model_id):
                result[name] = item.async_model
    return result


def _effective_default_model():
    async def read():
        async with _core.Client() as client:
            return await client._run(lambda: client._bridge.call("resolve_model", _core._configuration_context()), client._timeout)
    return _sync(read())


DEFAULT_MODEL = "gpt-4o-mini"


def get_default_model(filename="default_model.txt", default=DEFAULT_MODEL):
    filename = os.fspath(filename)
    async def read():
        async with _core.Client() as client:
            payload = {**_core._configuration_context(), "action": "get", "filename": filename}
            return await client._run(lambda: client._bridge.call("default_model", payload), client._timeout)
    value = _sync(read())
    return default if value is None else value


def set_default_model(model, filename="default_model.txt"):
    if model is not None and not isinstance(model, str):
        raise TypeError("data must be str, not " + type(model).__name__)
    filename = os.fspath(filename)
    async def write():
        async with _core.Client() as client:
            payload = {**_core._configuration_context(), "action": "set", "filename": filename, "model": model}
            return await client._run(lambda: client._bridge.call("default_model", payload), client._timeout)
    result = _sync(write())
    if result is not None and result.get("missing"):
        raise TypeError("data must be str, not NoneType")


def get_default_embedding_model():
    return get_default_model("default_embedding_model.txt", None)


def set_default_embedding_model(model):
    set_default_model(model, "default_embedding_model.txt")


def get_model(name=None, _skip_async=False):
    aliases = get_model_aliases()
    name = name or _effective_default_model()
    try:
        return aliases[name]
    except KeyError:
        raise UnknownModelError("Unknown model: " + str(name)) from None


def get_async_model(name=None):
    aliases = get_async_model_aliases()
    name = name or _effective_default_model()
    try:
        return aliases[name]
    except KeyError:
        raise UnknownModelError("Unknown model: " + str(name)) from None


def schema_dsl(schema_dsl, multi=False):
    async def parse():
        async with _core.Client() as client:
            payload = {"schema": schema_dsl, "multi": bool(multi)}
            return await client._run(lambda: client._bridge.call("schema_dsl", payload), client._timeout)
    return _sync(parse())


def encode(values):
    import struct
    return struct.pack("<" + "f" * len(values), *values)


def decode(binary):
    import struct
    return struct.unpack("<" + "f" * (len(binary) // 4), binary)


def cosine_similarity(a, b):
    dot_product = sum(x * y for x, y in zip(a, b))
    magnitude_a = sum(x * x for x in a) ** 0.5
    magnitude_b = sum(x * x for x in b) ** 0.5
    return dot_product / (magnitude_a * magnitude_b)


class EmbeddingModel:
    supports_text = True
    supports_binary = False
    batch_size = None
    key = None

    def __init__(self, model_id=None):
        if model_id is not None:
            self.model_id = model_id

    def __str__(self):
        return self.__class__.__name__ + ": " + self.model_id

    def __repr__(self):
        return "<" + str(self) + ">"

    def _check(self, item):
        if not self.supports_binary and isinstance(item, bytes):
            raise ValueError("This model does not support binary data, only text strings")
        if not self.supports_text and isinstance(item, str):
            raise ValueError("This model does not support text strings, only binary data")

    def embed_batch(self, items):
        async def embed():
            async with _core.Client(model=self.model_id, key=self.key) as client:
                return await client.embed(items)
        result = _sync(embed())
        for vector in result.vectors:
            yield list(vector)

    def embed(self, item):
        self._check(item)
        return next(iter(self.embed_batch([item])))

    def embed_multi(self, items, batch_size=None):
        from itertools import islice
        def checked():
            for item in items:
                self._check(item)
                yield item
        iterator = checked()
        effective_batch_size = self.batch_size if batch_size is None else batch_size
        if effective_batch_size is None:
            yield from self.embed_batch(iterator)
            return
        while True:
            batch = list(islice(iterator, effective_batch_size))
            if not batch:
                return
            yield from self.embed_batch(batch)


def get_embedding_models_with_aliases():
    return [
        EmbeddingModelWithAliases(EmbeddingModel(item.id), list(item.aliases))
        for item in _sync(_models()) if "embed" in item.capabilities
    ]


def get_embedding_models():
    return [item.model for item in get_embedding_models_with_aliases()]


def get_embedding_model_aliases():
    result = {}
    for item in get_embedding_models_with_aliases():
        for name in (*item.aliases, item.model.model_id):
            result[name] = item.model
    return result


def get_embedding_model(name):
    try:
        return get_embedding_model_aliases()[name]
    except KeyError:
        raise UnknownModelError("Unknown model: " + str(name)) from None
`)();
