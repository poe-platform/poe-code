/** Provider plugin for the unmodified, pinned LLM Python distribution. */
export const pythonLlmProvider = /* @__PURE__ */ (() => String.raw`"""LLM's provider interface backed by the invocation-owned host capability."""
from contextlib import contextmanager
from dataclasses import replace
from itertools import islice
from typing import Optional
import os
import sys

import llm
from pydantic import Field, create_model

# The runtime's enabled provider owns network authorization and billing.
# Keep the genuine plugin manager; disable the bundled direct-HTTP provider.
llm.plugins.pm.set_blocked("llm.default_plugins.openai_models")
llm.plugins.pm.set_blocked("llm.default_plugins.default_tools")


def restrict_providers():
    def reject(*args, **kwargs):
        raise llm.ModelError("This runtime uses platform-configured providers")
    llm.plugins.pm.register = reject
    llm.plugins.pm.load_setuptools_entrypoints = reject


def _context():
    return {"cwd": os.getcwd(), "configuration_env": {
        name: os.environ.get(name) for name in ("HOME", "XDG_CONFIG_HOME", "LLM_USER_PATH")
    }}


def _check(value):
    if isinstance(value, dict) and value.get("error"):
        error = value["error"]
        raise llm.ModelError(error.get("message", "LLM host operation failed"))
    return value


def _call(operation, payload):
    import safe_host
    try:
        return _check(safe_host.call("llm", {"operation": operation, "payload": payload}))
    except safe_host.HostError as error:
        raise llm.ModelError(str(error)) from error


def _catalog():
    return _call("models", _context())


def _options(descriptions):
    fields = {}
    types = {"number": float, "integer": int, "boolean": bool, "string": str}
    for name, description in descriptions.items():
        annotation = Optional[types[description["type"]]]
        constraints = {}
        if "minimum" in description:
            constraints["ge"] = description["minimum"]
        if "maximum" in description:
            constraints["le"] = description["maximum"]
        fields[name] = (annotation, Field(default=None, description=description.get("description"), **constraints))
    return create_model("Options", __base__=llm.Options, **fields)


def _attachment_type(attachment):
    if attachment.url and not attachment.type and not attachment.path:
        return _call("attachment_head", {"url": attachment.url})
    return attachment.resolve_type()


@contextmanager
def _request(model, prompt, stream, response, conversation):
    if response._key is not None or model.key is not None:
        raise llm.ModelError("This runtime uses platform-managed credentials")
    temporary_inputs = []

    def spool(chunks):
        handle = _call("input_open", _context())
        temporary_inputs.append(handle)
        for chunk in chunks:
            _call("input_write", {"id": handle, "bytes": list(chunk)})
        return {"spool": handle}

    def text_input(text):
        text = text or ""
        if len(text) <= 4096:
            return text
        return spool(text[start:start + 4096].encode("utf-8")
                     for start in range(0, len(text), 4096))

    try:
        messages = []
        for previous in conversation.responses if conversation else ():
            if previous.prompt.system:
                messages.append({"role": "system", "content": text_input(previous.prompt.system)})
            messages.append({"role": "user", "content": text_input(previous.prompt.prompt)})
            messages.append({"role": "assistant", "content": text_input(previous.text_or_raise())})
            if previous.prompt.attachments:
                raise llm.ModelError("This host transport does not support attachments in conversation history")
        payload = {**_context(), "model": model.model_id, "prompt": text_input(prompt.prompt),
                   "messages": messages, "stream": stream, "attachments": [], "retain_response": True,
                   "options": prompt.options.model_dump(exclude_none=True)}
        if prompt.system:
            payload["system"] = text_input(prompt.system)
        if prompt.schema is not None:
            payload["schema"] = prompt.schema
        for attachment in prompt.attachments:
            if attachment.content or (
                attachment.content is not None and not attachment.path and not attachment.url
            ):
                content = memoryview(attachment.content)
                source = spool(content[start:start + 16384] for start in range(0, len(content), 16384))
            elif attachment.path:
                source = {"path": os.path.abspath(attachment.path)}
            elif attachment.url:
                handle = _call("input_url", {**_context(), "url": attachment.url})
                temporary_inputs.append(handle)
                source = {"spool": handle}
            else:
                raise llm.ModelError("Attachment requires a path, URL or content")
            payload["attachments"].append({**source, "mimeType": _attachment_type(attachment)})
        yield payload
    finally:
        failing = sys.exc_info()[0] is not None
        for handle in temporary_inputs:
            try:
                _call("input_close", {"id": handle})
            except llm.ModelError:
                if not failing:
                    raise


def _event(event, response):
    _check(event)
    if event["type"] == "text":
        return event["text"]
    if event["type"] == "response":
        result = event["response"]
        usage = result.get("usage", {})
        response.set_usage(input=usage.get("input"), output=usage.get("output"),
                           details=usage.get("details"))
        response.response_json = result.get("metadata", {})
        response.resolved_model = result.get("model", response.model.model_id)
        return None
    raise llm.ModelError("This model returned non-text output")


class _HostModel:
    can_stream = True

    def _validate_attachments(self, attachments=None):
        # Use genuine validation without changing caller-owned Attachment fields.
        if attachments and self.attachment_types:
            attachments = [
                replace(item, type=_attachment_type(item))
                if item.url and not item.type and not item.path else item
                for item in attachments
            ]
        return super()._validate_attachments(attachments)

    def __init__(self, entry):
        self.model_id = entry["id"]
        self.supports_schema = "schema" in entry["capabilities"]
        self.attachment_types = set(entry["metadata"]["attachmentTypes"])
        self.Options = _options(entry["metadata"].get("options", {}))


class HostModel(_HostModel, llm.Model):
    def execute(self, prompt, stream, response, conversation):
        import safe_host
        with _request(self, prompt, stream, response, conversation) as payload:
            try:
                with safe_host.stream("llm", payload) as events:
                    for event in events:
                        text = _event(event, response)
                        if text is not None:
                            yield text
            except safe_host.HostError as error:
                raise llm.ModelError(str(error)) from error


class HostAsyncModel(_HostModel, llm.AsyncModel):
    async def execute(self, prompt, stream, response, conversation):
        from _poe_llm_capability import bridge
        from poe_llm import LlmError
        import safe_host
        with _request(self, prompt, stream, response, conversation) as payload:
            events = bridge.stream(payload)
            try:
                async for event in events:
                    text = _event(event, response)
                    if text is not None:
                        yield text
            except (LlmError, safe_host.HostError) as error:
                raise llm.ModelError(str(error)) from error
            finally:
                await events.aclose()


class HostEmbeddingModel(llm.EmbeddingModel):
    batch_size = 128

    def __init__(self, entry):
        self.model_id = entry["id"]

    def embed_batch(self, items):
        items = iter(items)
        while True:
            batch = list(islice(items, self.batch_size))
            if not batch:
                return
            if self.key is not None:
                raise llm.ModelError("This runtime uses platform-managed credentials")
            result = _call("embed", {**_context(), "model": self.model_id, "inputs": batch})
            yield from result["vectors"]


@llm.hookimpl(trylast=True)
def register_models(register):
    entries = _catalog()
    # Keep the genuine resolver, with the platform fallback held only in memory.
    # Model lookup must not create a persistent configuration file.
    llm.get_default_model.__defaults__ = ("default_model.txt", _call("resolve_model", _context()))
    for entry in entries:
        if entry["metadata"]["outputType"] == "text/plain" and set(entry["capabilities"]) != {"embed"}:
            register(HostModel(entry), HostAsyncModel(entry), aliases=entry["aliases"])


@llm.hookimpl(trylast=True)
def register_embedding_models(register):
    for entry in _catalog():
        if "embed" in entry["capabilities"]:
            register(HostEmbeddingModel(entry), aliases=entry["aliases"])
`)();
