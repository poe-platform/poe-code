/** Public Python calling conventions over the invocation-owned internal client. */
export const pythonLlmReferenceModule = /* @__PURE__ */ (() => String.raw`
"""Lazy synchronous and asynchronous model responses backed by JavaScript."""
import asyncio
import inspect
import datetime as _datetime
from dataclasses import dataclass, field
import os
import time
import poe_llm as _core

Error = _core.LlmError


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
        if self.url is not None or self.content is not None:
            raise NotImplementedError("Prompt attachments currently require a canonical filesystem path")
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


class Prompt:
    def __init__(self, prompt, model, *, fragments=None, attachments=None,
                 system=None, system_fragments=None, prompt_json=None,
                 options=None, schema=None, tools=None, tool_results=None):
        if tools or tool_results:
            raise NotImplementedError("Tools require shared service support")
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
        self.tools = []
        self.tool_results = []

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
            if self._client is None:
                self._start = time.monotonic()
                self._start_utcnow = _datetime.datetime.now(_datetime.timezone.utc)
                self._client = _core.Client(model=self.model.model_id, key=self._key)
                values = dict(system=self.prompt.system, options=self.prompt.options,
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
        async def chunks():
            if self._done:
                for chunk in self._chunks:
                    yield chunk
                return
            try:
                while True:
                    try:
                        chunk = await self._next()
                    except StopAsyncIteration:
                        return
                    yield chunk
            finally:
                if not self._done:
                    await self.aclose()
        return chunks()

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
    supports_schema = False
    supports_tools = False
    attachment_types = set()

    def __init__(self, model_id, *, capabilities=(), metadata=None):
        self.model_id = model_id
        self.supports_schema = "schema" in capabilities
        self.attachment_types = set((metadata or {}).get("attachmentTypes", ()))

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
        if schema is not None and hasattr(schema, "model_json_schema"):
            schema = schema.model_json_schema()
        return Response(Prompt(prompt, self, system=system, attachments=attachments,
                               fragments=fragments, system_fragments=system_fragments,
                               tools=tools, tool_results=tool_results,
                               schema=schema, options=options), self, stream, key=key)


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


class AsyncConversation(Conversation):
    def to_sync_conversation(self):
        return Conversation(model=self.model, id=self.id, name=self.name, responses=[],
                            tools=self.tools, chain_limit=self.chain_limit)


class UnknownModelError(KeyError):
    pass


async def _models():
    async with _core.Client() as client:
        return await client.models()


def get_models():
    return [Model(item.id, capabilities=item.capabilities, metadata=item.metadata) for item in _sync(_models())]


def get_async_models():
    return [AsyncModel(item.id, capabilities=item.capabilities, metadata=item.metadata) for item in _sync(_models())]


def get_model_aliases():
    result = {}
    for item in _sync(_models()):
        model = Model(item.id, capabilities=item.capabilities, metadata=item.metadata)
        for name in (item.id, *item.aliases):
            result[name] = model
    return result


def get_async_model_aliases():
    result = {}
    for item in _sync(_models()):
        model = AsyncModel(item.id, capabilities=item.capabilities, metadata=item.metadata)
        for name in (item.id, *item.aliases):
            result[name] = model
    return result


def get_default_model():
    async def read():
        async with _core.Client() as client:
            return await client._run(lambda: client._bridge.call("resolve_model", _core._configuration_context()), client._timeout)
    return _sync(read())


def get_model(name=None, _skip_async=False):
    aliases = get_model_aliases()
    name = name or get_default_model()
    try:
        return aliases[name]
    except KeyError:
        raise UnknownModelError("Unknown model: " + str(name)) from None


def get_async_model(name=None):
    aliases = get_async_model_aliases()
    name = name or get_default_model()
    try:
        return aliases[name]
    except KeyError:
        raise UnknownModelError("Unknown model: " + str(name)) from None


class EmbeddingModel:
    supports_text = True
    supports_binary = False
    batch_size = None
    key = None

    def __init__(self, model_id):
        self.model_id = model_id

    def _check(self, item):
        if isinstance(item, bytes):
            raise ValueError("This model does not support binary data, only text strings")

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


def get_embedding_models():
    return [EmbeddingModel(item.id) for item in _sync(_models()) if "embed" in item.capabilities]


def get_embedding_model_aliases():
    result = {}
    for item in _sync(_models()):
        if "embed" not in item.capabilities:
            continue
        model = EmbeddingModel(item.id)
        for name in (item.id, *item.aliases):
            result[name] = model
    return result


def get_embedding_model(name):
    try:
        return get_embedding_model_aliases()[name]
    except KeyError:
        raise UnknownModelError("Unknown model: " + str(name)) from None
`)();
