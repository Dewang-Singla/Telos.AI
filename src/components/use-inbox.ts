"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { browserClient } from "@/lib/supabase/client";
import { unreadMessages } from "@/lib/chat-state";
import type { Conversation } from "@/lib/types";

export function useInbox(userId: string | undefined, revision: number) {
  const [state, setState] = useState<{ owner?: string; rows: Conversation[] }>({
    rows: [],
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [activeChat, setActiveChat] = useState<string | null>(null);
  const [visible, setVisible] = useState(true);
  const sequence = useRef(0);
  const pending = useRef<Promise<void> | null>(null);
  const dirty = useRef(false);
  const owner = useRef(userId);
  const cursors = useRef(new Map<string, string>());
  const refreshInbox = useCallback((): Promise<void> => {
    if (!userId || owner.current !== userId) return Promise.resolve();
    if (pending.current) {
      dirty.current = true;
      return pending.current;
    }
    const version = sequence.current;
    const task = (async () => {
      do {
        dirty.current = false;
        try {
          const rows = await api<Conversation[]>("conversations");
          if (version !== sequence.current) return;
          setState({ owner: userId, rows });
          setError("");
        } catch (e) {
          if (version === sequence.current) setError((e as Error).message);
        } finally {
          if (version === sequence.current) setLoading(false);
        }
      } while (dirty.current && version === sequence.current);
    })().finally(() => {
      if (pending.current === task) pending.current = null;
    });
    pending.current = task;
    return task;
  }, [userId]);
  const readMessages = useCallback(
    async (id: string, lastMessageId: string) => {
      if (
        !userId ||
        owner.current !== userId ||
        cursors.current.get(id) === lastMessageId
      )
        return;
      await api("read", { id, last_message_id: lastMessageId });
      if (owner.current !== userId) return;
      cursors.current.set(id, lastMessageId);
      await refreshInbox();
    },
    [refreshInbox, userId],
  );
  useEffect(() => {
    owner.current = userId;
    const version = ++sequence.current;
    pending.current = null;
    dirty.current = false;
    cursors.current.clear();
    setActiveChat(null);
    setState({ owner: userId, rows: [] });
    setError("");
    setLoading(Boolean(userId));
    if (!userId) return;
    const db = browserClient();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void refreshInbox(), 100);
    };
    const visibleRefresh = () => {
      const isVisible = document.visibilityState === "visible";
      setVisible(isVisible);
      if (isVisible) refresh();
    };
    const channel = db
      .channel(`inbox-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        refresh,
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "conversation_members",
          filter: `user_id=eq.${userId}`,
        },
        refresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    void refreshInbox();
    visibleRefresh();
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 20000);
    document.addEventListener("visibilitychange", visibleRefresh);
    window.addEventListener("focus", visibleRefresh);
    window.addEventListener("online", visibleRefresh);
    return () => {
      if (sequence.current === version) sequence.current = version + 1;
      clearTimeout(timer);
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visibleRefresh);
      window.removeEventListener("focus", visibleRefresh);
      window.removeEventListener("online", visibleRefresh);
      void db.removeChannel(channel);
    };
  }, [userId, refreshInbox]);
  useEffect(() => {
    void refreshInbox();
  }, [revision, refreshInbox]);
  const rows = state.owner === userId ? state.rows : [];
  const reading = visible ? activeChat : null;
  return {
    conversations: rows.map((chat) =>
      chat.id === reading ? { ...chat, unread: 0 } : chat,
    ),
    unreadCount: unreadMessages(rows, reading),
    inboxLoading: Boolean(userId) && (loading || state.owner !== userId),
    inboxError: error,
    refreshInbox,
    readMessages,
    setActiveChat,
  };
}
