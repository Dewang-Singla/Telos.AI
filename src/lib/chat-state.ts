import type { Conversation, Message } from "./types";

export function latestMessage(messages: Message[]) {
  return messages.reduce<Message | undefined>(
    (latest, message) =>
      !latest || compareMessages(latest, message) < 0 ? message : latest,
    undefined,
  );
}

export function compareMessages(
  a: Pick<Message, "created_at" | "id">,
  b: Pick<Message, "created_at" | "id">,
) {
  return a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id);
}

export function mergeMessages(previous: Message[], incoming: Message[]) {
  const merged = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) merged.set(message.id, message);
  return [...merged.values()].sort(compareMessages);
}

export function unreadMessages(
  conversations: Conversation[],
  activeChat: string | null,
) {
  return conversations.reduce(
    (count, chat) => count + (chat.id === activeChat ? 0 : chat.unread || 0),
    0,
  );
}
