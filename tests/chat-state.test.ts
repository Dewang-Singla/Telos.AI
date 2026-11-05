import { describe, expect, it } from "vitest";
import {
  latestMessage,
  mergeMessages,
  unreadMessages,
} from "../src/lib/chat-state";
import type { Conversation, Message } from "../src/lib/types";

const message = (id: string, time = "2026-11-05T10:00:00Z") =>
  ({
    id,
    created_at: time,
    conversation_id: "chat",
    sender_id: "person",
    body: id,
  }) as Message;
describe("inbox and delivered-message state", () => {
  it("counts messages from other chats while the current chat is open", () => {
    const chats = [
      { id: "one", unread: 4 },
      { id: "two", unread: 2 },
    ] as Conversation[];
    expect(unreadMessages(chats, "one")).toBe(2);
    expect(unreadMessages(chats, null)).toBe(6);
  });
  it("deduplicates HTTP/realtime delivery and keeps deterministic order", () => {
    const a = message("a"),
      b = message("b");
    expect(mergeMessages([b], [a, b])).toEqual([a, b]);
    expect(latestMessage([b, a])).toEqual(b);
    expect(latestMessage([])).toBeUndefined();
  });
  it("uses the latest displayed message as the read cursor", () => {
    const first = message("a");
    const latest = message("b", "2026-11-05T10:01:00Z");
    expect(latestMessage([latest, first])?.id).toBe("b");
  });
});
