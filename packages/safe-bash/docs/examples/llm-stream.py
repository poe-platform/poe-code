"""Run with the authenticated Safe Bash Python launcher."""
import llm

for chunk in llm.get_model().prompt("Explain gravity"):
    print(chunk, end="", flush=True)
