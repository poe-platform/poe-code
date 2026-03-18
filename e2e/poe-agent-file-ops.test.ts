import { describe, it, expect } from 'vitest';
import { useContainer, shellQuote } from '@poe-code/e2e-docker-test-runner';

const FILE_PATH = '/workspace/test-document.txt';
const RENAMED_PATH = '/workspace/renamed-document.txt';

const ORIGINAL_CONTENT = [
  'The Art of Software Testing',
  '',
  'Software testing is a critical discipline that ensures the quality and reliability',
  'of applications. It involves systematically verifying that software behaves as',
  'expected under various conditions, catching defects before they reach end users.',
  'Without rigorous testing, even the most elegantly written code can harbor subtle',
  'bugs that surface only in production environments.',
  '',
  'Testing methodologies range from unit tests, which verify individual components in',
  'isolation, to integration tests that ensure different parts of a system work together',
  'harmoniously. Each level of testing serves a unique purpose in the overall quality',
  'assurance strategy, forming what is commonly known as the testing pyramid.',
  '',
  'The practice of test-driven development has gained widespread adoption in modern',
  'software engineering. By writing tests before implementation, developers create a',
  'clear specification of desired behavior and build confidence in their code through',
  'continuous verification. This approach naturally leads to modular, well-structured',
  'code that is easier to maintain and extend over time.',
].join('\n');

const REPLACEMENT_PARAGRAPH = [
  'End-to-end testing represents the pinnacle of the testing pyramid, validating entire',
  'user workflows from start to finish. These tests exercise the full stack, including',
  'databases, APIs, and user interfaces, providing the highest confidence that the system',
  'works as intended for real users in production scenarios.',
].join('\n');

describe('poe-agent file operations', () => {
  const container = useContainer({ testName: 'poe-agent-file-ops', useSnapshots: true });

  it('creates, edits, renames, and deletes a file', async () => {
    const configResult = await container.exec('poe-code configure poe-agent --yes');
    expect(configResult).toHaveExitCode(0);

    // Step 1: Create file
    const createPrompt = `Using the edit_file tool with command "create", create the file ${FILE_PATH} with this exact content:\n\n${ORIGINAL_CONTENT}`;
    const createResult = await container.exec(`poe-code spawn poe-agent ${shellQuote(createPrompt)}`);
    expect(createResult).toHaveExitCode(0);

    await expect(container).toHaveFile(FILE_PATH);
    const createdContent = await container.readFile(FILE_PATH);
    expect(createdContent).toBe(ORIGINAL_CONTENT);

    // Step 2: Edit file — replace the third paragraph
    const oldParagraph = ORIGINAL_CONTENT.split('\n\n')[2];
    const editPrompt = `In the file ${FILE_PATH}, use the edit_file tool with command "str_replace" to replace the following old_str:\n\n${oldParagraph}\n\nWith this new_str:\n\n${REPLACEMENT_PARAGRAPH}`;
    const editResult = await container.exec(`poe-code spawn poe-agent ${shellQuote(editPrompt)}`);
    expect(editResult).toHaveExitCode(0);

    const editedContent = await container.readFile(FILE_PATH);
    expect(editedContent).toContain(REPLACEMENT_PARAGRAPH);
    expect(editedContent).not.toContain(oldParagraph);
    expect(editedContent).toContain('The Art of Software Testing');

    // Step 3: Rename file
    const renamePrompt = `Using the run_command tool, rename the file ${FILE_PATH} to ${RENAMED_PATH} with the mv command.`;
    const renameResult = await container.exec(`poe-code spawn poe-agent ${shellQuote(renamePrompt)}`);
    expect(renameResult).toHaveExitCode(0);

    await expect(container).toHaveFile(RENAMED_PATH);
    await expect(container).not.toHaveFile(FILE_PATH);
    const renamedContent = await container.readFile(RENAMED_PATH);
    expect(renamedContent).toContain(REPLACEMENT_PARAGRAPH);

    // Step 4: Delete file
    const deletePrompt = `Using the run_command tool, delete the file ${RENAMED_PATH} with the rm command.`;
    const deleteResult = await container.exec(`poe-code spawn poe-agent ${shellQuote(deletePrompt)}`);
    expect(deleteResult).toHaveExitCode(0);

    await expect(container).not.toHaveFile(RENAMED_PATH);
  });
});
