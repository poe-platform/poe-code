"""Run with the Safe Bash JSPI launcher and an invocation LLM capability."""
from poe_llm import Client
from pyodide.ffi import run_sync


async def main():
    async with Client() as client:
        response = await client.complete("Explain gravity in one sentence")
        print(response.text)


run_sync(main())
