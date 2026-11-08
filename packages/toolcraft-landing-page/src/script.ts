export const SCRIPT = String.raw`
      const copyStatus = document.querySelector("#copy-status");

      for (const button of document.querySelectorAll("[data-copy]")) {
        button.addEventListener("click", async () => {
          const command = button.dataset.copy;

          try {
            await navigator.clipboard.writeText(command);
            button.dataset.copied = "true";
            button.textContent = "Copied";
            copyStatus.textContent = "";
            window.requestAnimationFrame(() => {
              copyStatus.textContent = command + " copied to clipboard";
            });

            window.setTimeout(() => {
              button.dataset.copied = "false";
              button.textContent = "Copy";
            }, 1600);
          } catch {
            copyStatus.textContent = "";
            window.requestAnimationFrame(() => {
              copyStatus.textContent = "Could not copy " + command;
            });
          }
        });
      }
`;
