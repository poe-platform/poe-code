"""Run with the Safe Bash JSPI launcher and an invocation LLM capability."""
from dataclasses import replace
from poe_llm import Client
from pyodide.ffi import run_sync


def normalize(request):
    return replace(request, prompt=request.prompt.strip())


def uppercase(response):
    return replace(response, text=response.text.upper())


async def main():
    async with Client(
        system="Be concise",
        options={"temperature": 0.2},
        request_transform=normalize,
        response_transform=uppercase,
    ) as client:
        explain = client.prompt(lambda topic: f"  Explain {topic}  ")
        print((await explain("gravity")).text)
        chat = client.conversation()
        await chat.complete("First")
        print((await chat.complete("Second")).text)


run_sync(main())
