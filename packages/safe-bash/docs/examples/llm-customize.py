"""Run with the authenticated Safe Bash Python launcher."""
import llm

model = llm.get_model()


def explain(topic):
    return model.prompt(
        f"Explain {topic}".strip(), system="Be concise", temperature=0.2
    ).text().upper()


print(explain("gravity"))
chat = model.conversation()
chat.prompt("First", system="Be concise").text()
print(chat.prompt("Second").text().upper())
