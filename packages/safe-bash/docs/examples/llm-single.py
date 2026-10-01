"""Run with the authenticated Safe Bash Python launcher."""
import llm

print(llm.get_model().prompt("Explain gravity in one sentence").text())
