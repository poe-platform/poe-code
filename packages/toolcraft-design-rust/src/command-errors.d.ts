export declare function formatCommandNotFound(input: {
  unknownCommand: string;
  helpCommand: string;
  suggestions?: readonly string[];
}): { label: string; hint: string };

export declare function formatCommandNotFoundPanel(input: {
  unknownCommand: string;
  helpCommand: string;
  suggestions?: readonly string[];
  title?: string;
}): { title: string; label: string; footer: string };
