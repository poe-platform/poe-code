if (process.env.HTML_QUALIFICATION_MODE === "hang") setInterval(() => {}, 1000);
else if (process.env.HTML_QUALIFICATION_MODE === "exit7") process.exitCode = 7;
else console.log("HTML_HARNESS_ONLY_POSITIVE");
