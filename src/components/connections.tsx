"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Users } from "lucide-react";
import { api } from "@/lib/api";
import type { Connection, Conversation, Profile } from "@/lib/types";
import { useTelos } from "./provider";
import { Avatar, Empty, Loading } from "./ui";

const tabs = [
  ["received", "Requests"],
  ["sent", "Sent"],
  ["connected", "Connected"],
  ["followers", "Followers"],
  ["following", "Following"],
] as const;
type Tab = (typeof tabs)[number][0];
export function Connections({
  openProfile,
  refreshParent,
}: {
  openProfile: (p: Profile) => void;
  refreshParent: () => void;
}) {
  const { user, toast, relationshipRevision, relationshipsChanged } =
    useTelos();
  const [tab, setTab] = useState<Tab>("received"),
    [requests, setRequests] = useState<Connection[]>([]),
    [people, setPeople] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState("");
  const version = useRef(0);
  const invalidate = useCallback(() => {
    version.current++;
  }, []);
  const isFollow = tab === "followers" || tab === "following";
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("tab");
    if (tabs.some(([id]) => id === value)) setTab(value as Tab);
  }, []);
  const load = useCallback(
    async (offset = 0) => {
      if (!user) return;
      const token = ++version.current;
      setLoading(true);
      try {
        if (isFollow) {
          const rows = await api<Profile[]>(
            `follows?direction=${tab}&offset=${offset}`,
          );
          if (version.current !== token) return;
          setPeople((old) =>
            offset
              ? [...old, ...rows.filter((p) => !old.some((o) => o.id === p.id))]
              : rows,
          );
          setMore(rows.length === 40);
        } else {
          const rows = await api<Connection[]>(
            `connections?tab=${tab}&offset=${offset}`,
          );
          if (version.current !== token) return;
          setRequests((old) =>
            offset
              ? [...old, ...rows.filter((p) => !old.some((o) => o.id === p.id))]
              : rows,
          );
          setMore(rows.length === 50);
        }
        setError("");
      } catch (e) {
        if (version.current === token) setError((e as Error).message);
      } finally {
        if (version.current === token) setLoading(false);
      }
    },
    [user, isFollow, tab],
  );
  useEffect(() => {
    setRequests([]);
    setPeople([]);
    setMore(false);
    void load();
    return invalidate;
  }, [load, relationshipRevision, invalidate]);
  async function act(
    id: string,
    action: "accept" | "decline" | "cancel" | "remove" | "unfollow",
  ) {
    if (pending) return;
    if (action === "remove" && !window.confirm("Remove this connection?"))
      return;
    setPending(id);
    try {
      if (action === "accept" || action === "decline")
        await api("respond", { id, accept: action === "accept" });
      else if (action === "unfollow")
        await api("follow", { id, following: false });
      else await api("connection-action", { id, action });
      relationshipsChanged();
      refreshParent();
      await load();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setPending("");
    }
  }
  if (!user)
    return (
      <Empty
        icon={<Users />}
        title="Connections"
        description=""
        action={
          <Link href="/login" className="primary-button">
            Sign in
          </Link>
        }
      />
    );
  return (
    <>
      <div
        className="timeline-tabs relationship-tabs"
        aria-label="Connections view"
      >
        {tabs.map(([id, label]) => (
          <button
            key={id}
            className={id === tab ? "selected" : ""}
            aria-pressed={id === tab}
            onClick={() => {
              if (tab === id) return;
              version.current++;
              setRequests([]);
              setPeople([]);
              setTab(id);
              window.history.replaceState(null, "", `/connections?tab=${id}`);
            }}
          >
            {label}
          </button>
        ))}
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {loading && !requests.length && !people.length ? (
        <Loading />
      ) : isFollow ? (
        people.map((person) => (
          <article className="connection-item" key={person.id}>
            <Avatar profile={person} onClick={() => openProfile(person)} />
            <div>
              <button
                className="plain-button"
                onClick={() => openProfile(person)}
              >
                <strong>{person.name}</strong>
              </button>
              <p>@{person.username}</p>
              {tab === "following" && (
                <button
                  className="secondary-button"
                  disabled={!!pending}
                  onClick={() => void act(person.id, "unfollow")}
                >
                  Unfollow
                </button>
              )}
            </div>
          </article>
        ))
      ) : (
        requests.map((r) => {
          const person = r.sender_id === user.id ? r.recipient : r.sender;
          return (
            <article className="connection-item" key={r.id}>
              <Avatar
                profile={person}
                onClick={() => person && openProfile(person)}
              />
              <div>
                <button
                  className="plain-button"
                  onClick={() => person && openProfile(person)}
                >
                  <strong>{person?.name || "Member"}</strong>
                </button>
                <p>{r.note}</p>
                <div className="connection-actions">
                  {tab === "received" && (
                    <>
                      <button
                        className="primary-button"
                        disabled={!!pending}
                        onClick={() => void act(r.id, "accept")}
                      >
                        Accept
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!!pending}
                        onClick={() => void act(r.id, "decline")}
                      >
                        Decline
                      </button>
                    </>
                  )}
                  {tab === "sent" && (
                    <button
                      className="secondary-button"
                      disabled={!!pending}
                      onClick={() => void act(r.id, "cancel")}
                    >
                      Cancel request
                    </button>
                  )}
                  {tab === "connected" && (
                    <>
                      <button
                        className="primary-button"
                        disabled={!!pending}
                        onClick={async () => {
                          try {
                            const rows =
                              await api<Conversation[]>("conversations");
                            const thread = rows.find(
                              (c) => c.request_id === r.id,
                            );
                            window.location.assign(
                              thread
                                ? `/messages?conversation=${thread.id}`
                                : "/messages",
                            );
                          } catch (e) {
                            toast((e as Error).message);
                          }
                        }}
                      >
                        Message
                      </button>
                      <button
                        className="secondary-button"
                        disabled={!!pending}
                        onClick={() => void act(r.id, "remove")}
                      >
                        Remove connection
                      </button>
                    </>
                  )}
                </div>
              </div>
            </article>
          );
        })
      )}
      {!loading && !error && (isFollow ? !people.length : !requests.length) && (
        <Empty
          icon={<Users />}
          title={
            tab === "received"
              ? "No requests"
              : tab === "sent"
                ? "No pending requests"
                : tab === "connected"
                  ? "No connections yet"
                  : tab === "followers"
                    ? "No followers yet"
                    : "Not following anyone yet"
          }
          description=""
        />
      )}
      {more && (
        <button
          className="load-more"
          disabled={loading}
          onClick={() => void load(isFollow ? people.length : requests.length)}
        >
          Show more
        </button>
      )}
    </>
  );
}
