// Built-in suggestions, used until the live list from ollama.com loads or when it cannot be fetched.
// Models that can call tools, which Lomra needs to turn a chat into generations.
const families: Record<string, string[]> = {
  qwen3: ["0.6b", "1.7b", "4b", "8b", "14b", "30b", "32b"],
  "qwen3-vl": ["2b", "4b", "8b", "30b"],
  "qwen3-coder": ["30b"],
  "qwen2.5": ["3b", "7b", "14b", "32b"],
  "qwen2.5-coder": ["7b", "14b", "32b"],
  "llama3.2": ["1b", "3b"],
  "llama3.1": ["8b", "70b"],
  "llama3.3": ["70b"],
  mistral: ["7b"],
  "mistral-nemo": ["12b"],
  "mistral-small3.2": ["24b"],
  "phi4-mini": ["3.8b"],
  phi4: ["14b"],
  "granite3.3": ["2b", "8b"],
  "gpt-oss": ["20b", "120b"],
  smollm2: ["1.7b"],
  hermes3: ["8b"],
  "command-r": ["35b"],
};

export const localModelSuggestions = Object.entries(families).flatMap(([name, tags]) => tags.map((tag) => `${name}:${tag}`));
