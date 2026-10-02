"""Independent deterministic providers for the pinned native LLM oracle."""
import contextlib
import io
import json
import hashlib
from pathlib import Path
import runpy
import sys
import os

import llm
import httpx
from pydantic import Field
from typing import Optional

calls = []

def attachment_http(method, url):
    assert url in ("https://files.example/note.txt", "https://files.example/large.txt")
    content = b"z" * (16 * 1024 * 1024 + 7) if url.endswith("/large.txt") else b"url attachment"
    return httpx.Response(200, headers={"content-type": "text/plain"},
                          content=content if method == "GET" else b"", request=httpx.Request(method, url))

httpx.head = lambda url: attachment_http("HEAD", url)
httpx.get = lambda url: attachment_http("GET", url)

def text_receipt(text):
    data = text.encode()
    return text if len(data) <= 1024 else {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}

def result_text(prompt):
    if prompt == "exact-output":
        return "é" * 131072
    if prompt in ("over-output", "empty-output"):
        raise llm.ModelError("Provider response limit exceeded")
    return "large-accepted" if prompt.startswith("LARGE:") else prompt

def record(prompt, stream, response, conversation):
    messages = []
    for previous in conversation.responses if conversation else ():
        if previous.prompt.system:
            messages.append({"role": "system", "content": previous.prompt.system})
        messages.extend([{"role": "user", "content": text_receipt(previous.prompt.prompt)},
                         {"role": "assistant", "content": previous.text_or_raise()}])
    calls.append({"prompt": text_receipt(prompt.prompt), "stream": stream, "messages": messages,
                  "options": prompt.options.model_dump(exclude_none=True),
                  **({"schema": prompt.schema} if prompt.schema is not None else {}),
                  "attachments": [{"mimeType": attachment.resolve_type(), "text": text_receipt(attachment.content_bytes().decode())}
                                  for attachment in prompt.attachments]})
    response.set_usage(input=3, output=2)
    response.response_json = {"id": "fixture-response"}

class ReferenceModel(llm.Model):
    model_id = "fixture"
    can_stream = True
    supports_schema = True
    attachment_types = {"text/plain"}
    class Options(llm.Options):
        temperature: Optional[float] = Field(default=None, ge=0, le=2)
    def execute(self, prompt, stream, response, conversation):
        record(prompt, stream, response, conversation)
        text = result_text(prompt.prompt)
        yield from [text[:2], text[2:]] if stream else [text]

class ReferenceAsyncModel(llm.AsyncModel):
    model_id = "fixture"
    can_stream = True
    supports_schema = True
    attachment_types = {"text/plain"}
    Options = ReferenceModel.Options
    async def execute(self, prompt, stream, response, conversation):
        record(prompt, stream, response, conversation)
        text = result_text(prompt.prompt)
        for chunk in [text[:2], text[2:]] if stream else [text]:
            yield chunk

class ReferenceEmbedding(llm.EmbeddingModel):
    model_id = "fixture-embed"
    def embed_batch(self, items):
        for item in items:
            yield [float(len(item)), 1.0]

class ReferencePlugin:
    __name__ = 'reference_fixture'
    @llm.hookimpl
    def register_models(self, register):
        register(ReferenceModel(), ReferenceAsyncModel())
    @llm.hookimpl
    def register_embedding_models(self, register):
        register(ReferenceEmbedding())

llm.plugins.DEFAULT_PLUGINS = ()
llm.plugins.pm.set_blocked("llm.default_plugins.openai_models")
llm.plugins.pm.register(ReferencePlugin(), "reference-fixture")
os.environ["LLM_USER_PATH"] = str(Path.cwd() / "llm-config")
llm.set_default_model("fixture")
captured = io.StringIO()
with contextlib.redirect_stdout(captured):
    runpy.run_path(sys.argv[1], run_name="__main__")
print(json.dumps({"stdout": captured.getvalue(), "calls": calls}, sort_keys=True))
