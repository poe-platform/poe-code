export const sampleFiles: Readonly<Record<string, string>> = Object.freeze({
  "/home/WELCOME.md": `# Welcome to the safe-bash playground

This workspace lives only in memory. Resetting or reloading discards changes.
Use the terminal to explore files, pipelines, redirections, and text commands.

Try:
  ls examples
  cat examples/hello.py
  cat data/words.txt | sort | uniq
  printf 'Hello from safe-bash!\\n' > greeting.txt

The examples are editable source files in several programming languages.
Python, Node.js, TypeScript, Rust, Go, C, Ruby, and Java runtimes/compilers are
not installed. These files are for reading and editing, not execution here.
The shell example uses the supported shell itself: bash examples/hello.sh

Uploads go to /home/uploads without replacing existing files.
Each uploaded or edited file is limited to 2 MiB; the workspace to 16 MiB.
Shell-created files may exceed 2 MiB within the 16 MiB file-byte budget.
The current directory persists between commands; variables and functions do not.
Download files you want to keep before leaving.
`,
  "/home/examples/hello.py": `message = "Hello, world! — Bonjour, monde! — こんにちは世界！"
print(message)
`,
  "/home/examples/hello.js": `const message = "Hello, world! — ¡Hola, mundo! — 你好，世界！";
console.log(message);
`,
  "/home/examples/hello.ts": `const message: string = "Hello, world! — Hallo, Welt! — مرحباً بالعالم!";
console.log(message);
`,
  "/home/examples/hello.rs": `fn main() {
    println!("Hello, world! — Witaj, świecie! — 안녕하세요 세계!");
}
`,
  "/home/examples/hello.go": `package main

import "fmt"

func main() {
    fmt.Println("Hello, world! — Ciao, mondo! — नमस्ते दुनिया!")
}
`,
  "/home/examples/hello.c": `#include <stdio.h>

int main(void) {
    puts("Hello, world! — Olá, mundo! — Hej, världen!");
    return 0;
}
`,
  "/home/examples/hello.rb": `message = "Hello, world! — Salut, monde! — Привет, мир!"
puts message
`,
  "/home/examples/hello.java": `class Hello {
    public static void main(String[] args) {
        System.out.println("Hello, world! — Hallo, wereld! — Γεια σου κόσμε!");
    }
}
`,
  "/home/examples/hello.sh": `printf '%s\\n' 'Hello, world!' 'Bonjour, monde!' 'こんにちは世界！'
`,
  "/home/data/people.json":
    JSON.stringify(
      [
        { name: "Ada", language: "English", greeting: "Hello" },
        { name: "María", language: "Spanish", greeting: "Hola" },
        { name: "葵", language: "Japanese", greeting: "こんにちは" }
      ],
      null,
      2
    ) + "\n",
  "/home/data/words.txt": "pear\napple\norange\napple\npear\nbanana\n",
  "/home/data/scores.csv": "name,score\nAda,98\nMaría,95\n葵,99\n"
});
