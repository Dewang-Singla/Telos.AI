"use client";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import type { User } from "@supabase/supabase-js";
import { browserClient, configured } from "@/lib/supabase/client";
import { api } from "@/lib/api";
import type { Profile } from "@/lib/types";
type State = {
  user: User | null;
  profile: Profile | null;
  loading: boolean;
  configured: boolean;
  error: string;
  onlineIds: string[];
  relationshipRevision: number;
  relationshipsChanged: () => void;
  refresh: () => Promise<void>;
  toast: (message: string) => void;
};
const Context = createContext<State | null>(null);
export const useTelos = () => useContext(Context)!;
export function Provider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null),
    [profile, setProfile] = useState<Profile | null>(null),
    [loading, setLoading] = useState(configured),
    [error, setError] = useState(""),
    [notice, setNotice] = useState("");
  const [onlineIds, setOnlineIds] = useState<string[]>([]);
  const [relationshipRevision, setRelationshipRevision] = useState(0);
  const relationshipsChanged = useCallback(
    () => setRelationshipRevision((r) => r + 1),
    [],
  );
  useEffect(() => {
    if (!user) return;
    const db = browserClient();
    const channel = db
      .channel(`relationships-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "relationship_events",
          filter: `user_id=eq.${user.id}`,
        },
        relationshipsChanged,
      )
      .subscribe();
    const refreshVisible = () => {
      if (document.visibilityState === "visible") relationshipsChanged();
    };
    const timer = setInterval(refreshVisible, 30000);
    window.addEventListener("focus", refreshVisible);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refreshVisible);
      void db.removeChannel(channel);
    };
  }, [user, relationshipsChanged]);
  const toast = useCallback((message: string) => setNotice(message), []);
  const refresh = useCallback(async () => {
    if (!configured) {
      setLoading(false);
      return;
    }
    try {
      const db = browserClient();
      const {
        data: { user },
        error,
      } = await db.auth.getUser();
      if (error && error.name !== "AuthSessionMissingError") throw error;
      setUser(user);
      setProfile(user ? await api<Profile | null>("profile") : null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void refresh();
    if (!configured) return;
    const { data } = browserClient().auth.onAuthStateChange(() => {
      setTimeout(() => void refresh(), 0);
    });
    return () => data.subscription.unsubscribe();
  }, [refresh]);
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(""), 6500);
    return () => clearTimeout(t);
  }, [notice]);
  useEffect(() => {
    if (!user || !profile) {
      setOnlineIds([]);
      return;
    }
    const sessionId = crypto.randomUUID();
    const update = () => {
      void api("presence", {
        session_id: sessionId,
        active: document.visibilityState === "visible",
      }).catch(() => {});
    };
    const leave = () => {
      navigator.sendBeacon(
        "/api/presence",
        new Blob([JSON.stringify({ session_id: sessionId, active: false })], {
          type: "application/json",
        }),
      );
    };
    const readPresence = () => {
      void api<string[]>("presence")
        .then(setOnlineIds)
        .catch(() => {});
    };
    const db = browserClient();
    const channel = db
      .channel("member-status")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "member_presence" },
        readPresence,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "member_presence" },
        readPresence,
      )
      .subscribe();
    update();
    readPresence();
    const timer = setInterval(() => {
      update();
      readPresence();
    }, 25000);
    document.addEventListener("visibilitychange", update);
    window.addEventListener("pagehide", leave);
    return () => {
      clearInterval(timer);
      void db.removeChannel(channel);
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("pagehide", leave);
      void api("presence", { session_id: sessionId, active: false }).catch(
        () => {},
      );
    };
  }, [user, profile]);
  return (
    <Context.Provider
      value={{
        user,
        profile,
        loading,
        configured,
        error,
        refresh,
        toast,
        onlineIds,
        relationshipRevision,
        relationshipsChanged,
      }}
    >
      {children}
      {notice && (
        <div className="toast" role="status">
          <span className="toast-dot" />
          {notice}
          <button
            onClick={() => setNotice("")}
            aria-label="Dismiss notification"
          >
            ×
          </button>
        </div>
      )}
    </Context.Provider>
  );
}
