import type { ConversationMessage, Generation } from "./generation";

export function chatTimeline(history: ConversationMessage[], generations: Generation[]) {
  const groups = history.map((message) => ({ message, tasks: [] as Generation[] }));
  const unmatched: Generation[] = [];
  for (const task of generations) {
    // Older chats only recorded the generated summary, not the calling message.
    const index = task.messageIndex ?? history.findIndex((message) => message.role === "assistant"
      && message.content.includes(`${task.category} generated with ${task.model}: ${task.prompt}`.slice(0, 8000)));
    if (groups[index]) groups[index].tasks.push(task);
    else unmatched.push(task);
  }
  return [...groups, ...(unmatched.length ? [{ message: undefined, tasks: unmatched }] : [])];
}
