"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2 } from "lucide-react";
import { api } from "@/lib/api";
import type { Profile, Relationship } from "@/lib/types";
import { useTelos } from "./provider";

export function ProfileRelationships({
  profile,
  onConnect,
}: {
  profile: Profile;
  onConnect: () => void;
}) {
  const { user, relationshipRevision, relationshipsChanged, toast } =
    useTelos();
  const [state, setState] = useState<Relationship | null>(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const own = profile.id === user?.id;
  const load = useCallback(async () => {
    const result = await api<Relationship>(`relationship?id=${profile.id}`);
    setState(result);
    setError("");
  }, [profile.id]);
  useEffect(() => {
    if (!user) {
      setState(null);
      return;
    }
    let cancelled = false;
    void api<Relationship>(`relationship?id=${profile.id}`)
      .then((result) => {
        if (!cancelled) {
          setState(result);
          setError("");
        }
      })
      .catch((e) => {
        if (!cancelled) setError((e as Error).message);
      });
    return () => {
      cancelled = true;
    };
  }, [user, profile.id, relationshipRevision]);
  async function act(
    action: "follow" | "cancel" | "remove" | "accept" | "decline",
  ) {
    if (!state || busy) return;
    if (
      action === "remove" &&
      !window.confirm(`Remove your connection with ${profile.name}?`)
    )
      return;
    setBusy(true);
    try {
      if (action === "follow")
        await api("follow", { id: profile.id, following: !state.following });
      else if (action === "accept" || action === "decline")
        await api("respond", {
          id: state.request_id,
          accept: action === "accept",
        });
      else await api("connection-action", { id: state.request_id, action });
      relationshipsChanged();
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="profile-relationships">
      {state && (
        <div className="relationship-counts">
          {own ? (
            <>
              <Link href="/connections?tab=followers">
                <strong>{state.follower_count}</strong> Followers
              </Link>
              <Link href="/connections?tab=following">
                <strong>{state.following_count}</strong> Following
              </Link>
              <Link href="/connections?tab=connected">
                <strong>{state.connection_count}</strong> Connections
              </Link>
            </>
          ) : (
            <>
              <span>
                <strong>{state.follower_count}</strong> Followers
              </span>
              <span>
                <strong>{state.following_count}</strong> Following
              </span>
              <span>
                <strong>{state.connection_count}</strong> Connections
              </span>
            </>
          )}
        </div>
      )}
      {!own && (
        <div className="relationship-actions">
          {user && !state && !error && (
            <Loader2
              className="spin"
              size={20}
              aria-label="Loading relationship"
            />
          )}
          {(!user || state?.connection === "none") && (
            <button
              className="primary-button"
              onClick={onConnect}
              disabled={busy}
            >
              Connect
            </button>
          )}
          {state?.connection === "sent" && (
            <button
              className="secondary-button"
              disabled={busy}
              onClick={() => void act("cancel")}
            >
              Cancel request
            </button>
          )}
          {state?.connection === "received" && (
            <>
              <button
                className="primary-button"
                disabled={busy}
                onClick={() => void act("accept")}
              >
                Accept request
              </button>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void act("decline")}
              >
                Decline
              </button>
            </>
          )}
          {state?.connection === "connected" && (
            <>
              <Link
                className="primary-button"
                href={
                  state.conversation_id
                    ? `/messages?conversation=${state.conversation_id}`
                    : "/messages"
                }
              >
                Message
              </Link>
              <button
                className="secondary-button"
                disabled={busy}
                onClick={() => void act("remove")}
              >
                Remove connection
              </button>
            </>
          )}
          {state && (
            <button
              className="secondary-button"
              aria-label={state.following ? "Unfollow" : "Follow"}
              aria-pressed={state.following}
              disabled={busy}
              onClick={() => void act("follow")}
            >
              {state.following ? "Following" : "Follow"}
            </button>
          )}
        </div>
      )}
      {error && (
        <button
          className="text-button"
          onClick={() => void load().catch((e) => toast((e as Error).message))}
        >
          Retry relationship
        </button>
      )}
    </div>
  );
}
