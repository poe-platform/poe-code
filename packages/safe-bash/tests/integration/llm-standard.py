import asyncio
import json
import os
from pathlib import Path
os.environ["LLM_LOAD_PLUGINS"] = ""
import llm
from importlib.metadata import version
from pydantic import BaseModel, ValidationError

os.environ["LLM_USER_PATH"] = str(Path.cwd() / "llm-config")
assert version("llm") == "0.27.1"
model = llm.get_model()
assert model.model_id == "fixture"
assert {entry.model_id for entry in llm.get_models()} == {"fixture"}
model = llm.get_model("fixture")
assert isinstance(model, llm.Model)
response = model.prompt("hello", temperature=0.5, bias={"42": 5}, stop=["end"])
assert isinstance(response, llm.Response)
assert "not yet done" in repr(response)
done = []
response.on_done(lambda value: done.append(value.text()))
# Native llm resets its start timestamp when replaying completed responses.
assert list(response) == ["he", "llo"]
assert response.duration_ms() >= 0
assert response.text() == "hello"
assert list(response) == ["he", "llo"]
assert done == ["hello"]
assert response.usage().input == 3
assert response.usage().output == 2
assert response.json() == {"id": "fixture-response"}
assert response.datetime_utc()
assert model.prompt("single", stream=False).text() == "single"
assert len(model.prompt("exact-output").text().encode()) == 262144
for prompt in ("over-output", "empty-output"):
    for stream in (True, False):
        try:
            model.prompt(prompt, stream=stream).text()
        except llm.ModelError:
            pass
        else:
            raise AssertionError("Retained response limit was ignored")
assert model.prompt("after-limit").text() == "after-limit"
assert model.prompt("last", fragments=["first", "second"], system_fragments=["  terse  ", "helpful"]).text() == "first\nsecond\nlast"
assert model.prompt("inline", attachments=[llm.Attachment(content=b"inline bytes", type="text/plain")]).text() == "inline"
assert model.prompt("empty-inline", attachments=[llm.Attachment(content=b"", type="text/plain")]).text() == "empty-inline"
url_attachment = llm.Attachment(url="https://files.example/note.txt")
assert model.prompt("url", attachments=[url_attachment]).text() == "url"
assert url_attachment.type is None
assert url_attachment.url == "https://files.example/note.txt"
assert model.prompt("empty-url-content", attachments=[llm.Attachment(url=url_attachment.url, content=b"")]).text() == "empty-url-content"
assert model.prompt("large-url", attachments=[llm.Attachment(url="https://files.example/large.txt")]).text() == "large-url"
conversation = model.conversation()
assert isinstance(conversation, llm.Conversation)
assert conversation.prompt("first", system="Be helpful", attachments=[llm.Attachment(content=b"history", type="text/plain")]).text() == "first"
conversation.responses[0].attachments = [llm.Attachment(content=b"restored history", type="text/plain")]
assert conversation.prompt("second").text() == "second"
assert len(conversation.responses) == 2
assert conversation.responses[1].conversation is conversation

class Answer(BaseModel):
    answer: str

with open("attachment.txt", "wb") as output:
    output.write(b"attached")
assert model.prompt("rich", attachments=[llm.Attachment(path="attachment.txt", type="text/plain")], schema=Answer, temperature="0.25").text() == "rich"
assert model.prompt("empty-path-content", attachments=[llm.Attachment(path="attachment.txt", content=b"", type="text/plain")]).text() == "empty-path-content"
try:
    model.prompt("bad", imaginary_option=True)
except ValidationError:
    pass
else:
    raise AssertionError("unknown option accepted")
try:
    llm.get_model("missing-fixture")
except llm.UnknownModelError:
    pass
else:
    raise AssertionError("unknown model accepted")
embedding = llm.get_embedding_model("fixture-embed")
assert isinstance(embedding, llm.EmbeddingModel)
assert embedding.embed("one") == [3.0, 1.0]
assert list(embedding.embed_multi(["one", "four"])) == [[3.0, 1.0], [4.0, 1.0]]

async def main():
    model = llm.get_async_model("fixture")
    assert isinstance(model, llm.AsyncModel)
    assert len((await model.prompt("exact-output").text()).encode()) == 262144
    for prompt in ("over-output", "empty-output"):
        for stream in (True, False):
            try:
                await model.prompt(prompt, stream=stream).text()
            except llm.ModelError:
                pass
            else:
                raise AssertionError("Async retained response limit was ignored")
    assert await model.prompt("after-limit").text() == "after-limit"
    assert await model.prompt("async-url", attachments=[llm.Attachment(url="https://files.example/note.txt")]).text() == "async-url"
    response = model.prompt("async")
    assert isinstance(response, llm.AsyncResponse)
    assert [chunk async for chunk in response] == ["as", "ync"]
    assert await response.text() == "async"
    assert await response.json() == {"id": "fixture-response"}
    assert (await response.usage()).output == 2
    assert await response.datetime_utc()
    assert await response.duration_ms() >= 0
    assert (await response.to_sync_response()).text() == "async"
    conversation = model.conversation()
    assert await conversation.prompt("first", attachments=[llm.Attachment(content=b"async history", type="text/plain")], stop=["end"]).text() == "first"
    assert await conversation.prompt("second").text() == "second"
    assert len(conversation.responses) == 2

asyncio.run(main())
large = "LARGE:" + "🙂" * (4 * 1024 * 1024 + 1)
large_conversation = model.conversation()
assert large_conversation.prompt(large).text() == "large-accepted"
assert large_conversation.prompt("after-large").text() == "after-large"
del large_conversation, large

print(json.dumps({"package": version("llm"), "sync": True, "async": True, "responses": True, "conversations": True, "schema": True, "attachments": True, "options": True, "embeddings": True}, sort_keys=True))
