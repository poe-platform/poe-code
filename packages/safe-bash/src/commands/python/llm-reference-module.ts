/** Public Python calling conventions over the invocation-owned internal client. */
export const pythonLlmReferenceModule = /* @__PURE__ */ (() => String.raw`
"""Lazy synchronous and asynchronous model responses backed by JavaScript."""
import asyncio
import inspect
from dataclasses import dataclass
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


class Prompt:
    def __init__(self, prompt, model, *, system=None, attachments=None, schema=None, options=None):
        self.prompt = prompt
        self.model = model
        self.system = system
        self.attachments = attachments or []
        self.schema = schema
        self.options = options or {}


class _Response:
    def __init__(self, prompt, model, stream, conversation=None, key=None):
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

    async def _finish(self):
        self._done = True
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
                self._client = _core.Client(model=self.model.model_id, key=self._key)
                values = dict(system=self.prompt.system, options=self.prompt.options,
                              attachments=self.prompt.attachments, schema=self.prompt.schema)
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
    def __init__(self, model_id):
        self.model_id = model_id

    def prompt(self, prompt=None, *, fragments=None, attachments=None, system=None,
               system_fragments=None, stream=True, schema=None, tools=None,
               tool_results=None, **options):
        if fragments or system_fragments or tools or tool_results:
            raise NotImplementedError("Fragments and tools are not yet supported by the bundled llm API")
        key = options.pop("key", None)
        if schema is not None and hasattr(schema, "model_json_schema"):
            schema = schema.model_json_schema()
        return Response(Prompt(prompt, self, system=system, attachments=attachments,
                               schema=schema, options=options), self, stream, key=key)


class AsyncModel(Model):
    def prompt(self, prompt=None, *, fragments=None, attachments=None, system=None,
               schema=None, tools=None, tool_results=None, system_fragments=None,
               stream=True, **options):
        response = super().prompt(prompt, fragments=fragments, attachments=attachments,
                                  system=system, schema=schema, tools=tools,
                                  tool_results=tool_results, system_fragments=system_fragments,
                                  stream=stream, **options)
        return AsyncResponse(response.prompt, self, stream, key=response._key)


def get_model(name=None, _skip_async=False):
    return Model(name)


def get_async_model(name=None):
    return AsyncModel(name)
`)();
