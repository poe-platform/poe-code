"""Run with the Safe Bash JSPI launcher and an invocation LLM capability."""
import sys
from poe_llm import Client
from pyodide.ffi import run_sync


async def main():
    async with Client() as client:
        async with client.stream("Explain gravity") as stream:
            async for event in stream:
                if event.type == "text":
                    print(event.text, end="", flush=True)
                elif event.type == "bytes":
                    sys.stdout.flush()
                    sys.stdout.buffer.write(event.data)
                    sys.stdout.buffer.flush()


run_sync(main())
