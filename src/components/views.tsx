"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Check,
  CheckCheck,
  ImagePlus,
  Link2,
  Loader2,
  LogOut,
  MapPin,
  MessageCircle,
  Search,
  Send,
  Settings,
  Users,
  Plus,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { browserClient } from "@/lib/supabase/client";
import { profileSchema } from "@/lib/validation";
import { profileLocation } from "@/lib/profile-location";
import type {
  Conversation,
  Intent,
  Message,
  Notification,
  Profile,
  SocialPost,
} from "@/lib/types";
import { useTelos } from "./provider";
import { Avatar, Empty, Loading } from "./ui";
import { PostComposer, SocialPostCard } from "./posts";
import { ProfileRelationships } from "./relationships";

export function ProfileView({
  profile,
  intents,
  own = false,
  onConnect,
  onProfile = () => {},
  onReport = () => {},
}: {
  profile: Profile;
  intents: Intent[];
  own?: boolean;
  onConnect: () => void;
  onEdit: () => void;
  onProfile?: (p: Profile) => void;
  onReport?: (post: SocialPost) => void;
}) {
  const { user, toast } = useTelos();
  const [tab, setTab] = useState("posts"),
    [posts, setPosts] = useState<SocialPost[]>([]),
    [loading, setLoading] = useState(false),
    [editing, setEditing] = useState<SocialPost | undefined>(),
    [compose, setCompose] = useState(false),
    [more, setMore] = useState(false);
  const [profileIntents, setProfileIntents] = useState(intents);
  useEffect(() => {
    setProfileIntents(intents);
  }, [intents]);
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;
    const reload = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void api<Intent[]>(`intents?user=${profile.id}`)
          .then((rows) => {
            if (!cancelled) setProfileIntents(rows);
          })
          .catch(() => {});
      }, 250);
    };
    const db = browserClient();
    const channel = db
      .channel(`profile-intents-${profile.id}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "discovery_events" },
        reload,
      )
      .subscribe();
    reload();
    return () => {
      cancelled = true;
      clearTimeout(timer);
      void db.removeChannel(channel);
    };
  }, [user, profile.id]);
  const load = useCallback(
    async (offset = 0) => {
      if (!user) return;
      setLoading(true);
      try {
        const rows = await api<SocialPost[]>(
          `posts?user=${profile.id}&offset=${offset}`,
        );
        setPosts((old) => (offset ? [...old, ...rows] : rows));
        setMore(rows.length === 20);
      } catch (e) {
        toast((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [user, profile.id, toast],
  );
  useEffect(() => {
    void load();
    if (!user) return;
    const db = browserClient();
    let timer: ReturnType<typeof setTimeout>;
    const channel = db
      .channel(`profile-posts-${profile.id}-${crypto.randomUUID()}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "feed_events",
          filter: `user_id=eq.${profile.id}`,
        },
        () => {
          clearTimeout(timer);
          timer = setTimeout(() => void load(), 300);
        },
      )
      .subscribe();
    return () => {
      clearTimeout(timer);
      void db.removeChannel(channel);
    };
  }, [load, user, profile.id]);
  const visibleIntents = profileIntents.filter(
    (i) => i.show_on_profile && i.status === "active",
  );
  const location = profileLocation(profile);
  return (
    <section className="member-profile">
      <div className="profile-cover">
        {profile.cover_url && <img src={profile.cover_url} alt="" />}
      </div>
      <div className="profile-info">
        <div className="profile-top-row">
          <Avatar profile={profile} size="profile-avatar" />
          {own ? (
            <Link href="/settings" className="secondary-button">
              Edit profile
            </Link>
          ) : null}
        </div>
        <h2>{profile.name}</h2>
        {profile.is_demo && <span className="demo-badge">Demo bot</span>}
        <p className="profile-username">@{profile.username}</p>
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        <div className="profile-facts">
          {location && (
            <span>
              <MapPin size={18} />
              {location}
            </span>
          )}
          {profile.portfolio && (
            <a
              href={profile.portfolio}
              target="_blank"
              rel="noopener noreferrer"
            >
              <Link2 size={18} />
              {profile.portfolio.replace(/^https:\/\//, "").split("/")[0]}
            </a>
          )}
        </div>
      </div>
      <ProfileRelationships
        key={profile.id}
        profile={profile}
        onConnect={onConnect}
      />
      {visibleIntents.length > 0 && (
        <section className="current-intents">
          <h3>Current intents</h3>
          {visibleIntents.map((intent) => (
            <article key={intent.id}>
              <p>{intent.description}</p>
            </article>
          ))}
        </section>
      )}
      <div className="timeline-tabs">
        <button
          className={tab === "posts" ? "selected" : ""}
          onClick={() => setTab("posts")}
        >
          Posts
        </button>
        <button
          className={tab === "about" ? "selected" : ""}
          onClick={() => setTab("about")}
        >
          About
        </button>
      </div>
      {tab === "posts" ? (
        <div className="profile-posts">
          {loading && !posts.length ? (
            <Loading />
          ) : (
            posts.map((post) => (
              <SocialPostCard
                key={post.id}
                post={post}
                onProfile={onProfile}
                onReport={onReport}
                onRefresh={() => void load()}
                onEdit={(post) => {
                  setEditing(post);
                  setCompose(true);
                }}
              />
            ))
          )}
          {!loading && !posts.length && (
            <Empty
              icon={<MessageCircle />}
              title="No posts yet"
              description=""
            />
          )}
          {more && (
            <button
              className="load-more"
              disabled={loading}
              onClick={() => void load(posts.length)}
            >
              Show more
            </button>
          )}
        </div>
      ) : (
        <div className="profile-about">
          {!!profile.details?.length && (
            <section>
              <h3>Details</h3>
              <dl className="profile-detail-list">
                {profile.details.map((field, index) => (
                  <div key={index}>
                    <dt>{field.label}</dt>
                    <dd>{field.value}</dd>
                  </div>
                ))}
              </dl>
            </section>
          )}
          {profile.interests.length > 0 && (
            <section>
              <h3>Interests</h3>
              <div className="profile-tags">
                {profile.interests.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </section>
          )}
          {profile.skills.length > 0 && (
            <section>
              <h3>Skills</h3>
              <div className="profile-tags">
                {profile.skills.map((t) => (
                  <span key={t}>{t}</span>
                ))}
              </div>
            </section>
          )}
          {!profile.skills.length &&
            !profile.interests.length &&
            !profile.details?.length && (
              <Empty icon={<Users />} title="No details added" description="" />
            )}
        </div>
      )}
      {compose && (
        <PostComposer
          existing={editing}
          close={() => {
            setCompose(false);
            setEditing(undefined);
          }}
          onSave={() => void load()}
        />
      )}
    </section>
  );
}

export { Connections } from "./connections";

export function Messages() {
  const { user, onlineIds, toast, relationshipRevision } = useTelos();
  const [conversations, setConversations] = useState<Conversation[]>([]),
    [selected, setSelected] = useState(""),
    [messages, setMessages] = useState<Message[]>([]),
    [body, setBody] = useState(""),
    [query, setQuery] = useState(""),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [older, setOlder] = useState(false),
    [loadingOlder, setLoadingOlder] = useState(false),
    [live, setLive] = useState(false);
  const end = useRef<HTMLDivElement>(null),
    current = useRef("");
  const history = useRef<HTMLDivElement>(null),
    preserveHeight = useRef<number | null>(null),
    stickToBottom = useRef(true);
  const deepLinkHandled = useRef(false);
  useEffect(() => {
    current.current = selected;
  }, [selected]);
  const loadConversations = useCallback(async () => {
    if (!user) return;
    try {
      const rows = await api<Conversation[]>("conversations");
      setConversations(rows);
      if (current.current && !rows.some((c) => c.id === current.current)) {
        setSelected("");
        setMessages([]);
      }
      if (!deepLinkHandled.current) {
        deepLinkHandled.current = true;
        const id = new URLSearchParams(window.location.search).get(
          "conversation",
        );
        if (id && rows.some((c) => c.id === id)) setSelected(id);
      }
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [user]);
  useEffect(() => {
    if (!user) return;
    setLoading(true);
    void loadConversations();
    const db = browserClient();
    const channel = db
      .channel("inbox-updates")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        () => void loadConversations(),
      )
      .subscribe();
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void loadConversations();
    }, 30000);
    return () => {
      clearInterval(timer);
      void db.removeChannel(channel);
    };
  }, [user, loadConversations, relationshipRevision]);
  const read = useCallback(async (id: string) => {
    await api("read", { id });
    if (current.current === id)
      setConversations((cs) =>
        cs.map((c) => (c.id === id ? { ...c, unread: 0 } : c)),
      );
  }, []);
  useEffect(() => {
    if (!user || !selected) return;
    let cancelled = false;
    stickToBottom.current = true;
    preserveHeight.current = null;
    setMessages([]);
    setError("");
    setOlder(false);
    const fetchMessages = async () => {
      try {
        const rows = await api<Message[]>(`messages?conversation=${selected}`);
        if (cancelled) return;
        setMessages((previous) => {
          const merged = new Map(previous.map((m) => [m.id, m]));
          for (const row of rows) merged.set(row.id, row);
          return [...merged.values()].sort(
            (a, b) =>
              a.created_at.localeCompare(b.created_at) ||
              a.id.localeCompare(b.id),
          );
        });
        setOlder(rows.length === 50);
        await read(selected);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    };
    void fetchMessages();
    const db = browserClient();
    const channel = db
      .channel(`chat-${selected}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "messages",
          filter: `conversation_id=eq.${selected}`,
        },
        (p) => {
          if (cancelled) return;
          const message = p.new as Message;
          setMessages((ms) =>
            ms.some((m) => m.id === message.id)
              ? ms
              : [...ms, message].sort((a, b) =>
                  a.created_at.localeCompare(b.created_at),
                ),
          );
          void read(selected).catch(() => {});
          void loadConversations();
        },
      )
      .subscribe((status) => {
        if (cancelled) return;
        setLive(status === "SUBSCRIBED");
        if (status === "SUBSCRIBED") void fetchMessages();
      });
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void fetchMessages();
    }, 15000);
    return () => {
      cancelled = true;
      clearInterval(timer);
      setLive(false);
      void db.removeChannel(channel);
    };
  }, [user, selected, read, loadConversations]);
  useEffect(() => {
    if (preserveHeight.current !== null && history.current) {
      history.current.scrollTop +=
        history.current.scrollHeight - preserveHeight.current;
      preserveHeight.current = null;
    } else if (messages.length && stickToBottom.current)
      end.current?.scrollIntoView({ block: "nearest" });
  }, [messages.length]);
  async function send() {
    if (
      !selected ||
      !body.trim() ||
      sending ||
      !conversations.find((c) => c.id === selected)?.can_message
    )
      return;
    const id = selected,
      text = body.trim();
    setSending(true);
    try {
      const message = await api<Message>("messages", {
        conversation_id: id,
        body: text,
      });
      if (current.current === id) {
        stickToBottom.current = true;
        setMessages((ms) =>
          ms.some((m) => m.id === message.id) ? ms : [...ms, message],
        );
        setBody("");
      }
      void loadConversations();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setSending(false);
    }
  }
  async function loadOlder() {
    if (!messages.length) return;
    const id = selected;
    setLoadingOlder(true);
    try {
      const rows = await api<Message[]>(
        `messages?conversation=${id}&before=${encodeURIComponent(messages[0].created_at)}&before_id=${messages[0].id}`,
      );
      if (current.current !== id) return;
      if (rows.length)
        preserveHeight.current = history.current?.scrollHeight ?? null;
      setMessages((ms) => [...rows, ...ms]);
      setOlder(rows.length === 50);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setLoadingOlder(false);
    }
  }
  if (!user)
    return (
      <Empty
        icon={<MessageCircle />}
        title="Messages"
        description=""
        action={
          <Link href="/login" className="primary-button">
            Sign in
          </Link>
        }
      />
    );
  const conversation = conversations.find((c) => c.id === selected),
    person = conversation?.conversation_members.find(
      (m) => m.user_id !== user.id,
    )?.profile;
  return (
    <>
      {error && (
        <div className="error-box" role="alert">
          {error}
          <button onClick={() => void loadConversations()}>Retry</button>
        </div>
      )}
      {loading ? (
        <Loading />
      ) : (
        <section className={`messenger ${selected ? "chat-open" : ""}`}>
          <aside className="chat-list">
            <header>
              <h2>Chats</h2>
              <Link
                href="/connections"
                className="icon-button"
                aria-label="Connections"
              >
                <MessageCircle size={23} />
              </Link>
            </header>
            <label className="chat-search">
              <Search size={20} />
              <input
                aria-label="Search chats"
                placeholder="Search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            {conversations
              .filter((c) =>
                (
                  c.conversation_members.find((m) => m.user_id !== user.id)
                    ?.profile?.name || ""
                )
                  .toLowerCase()
                  .includes(query.toLowerCase()),
              )
              .map((c) => {
                const p = c.conversation_members.find(
                  (m) => m.user_id !== user.id,
                )?.profile;
                return (
                  <button
                    className={`chat-list-item ${selected === c.id ? "selected" : ""}`}
                    key={c.id}
                    onClick={() => {
                      setSelected(c.id);
                      setBody("");
                    }}
                  >
                    <Avatar profile={p} />
                    <span className="chat-list-text">
                      <strong>{p?.name || "Member"}</strong>
                      <span>
                        {c.can_message
                          ? c.last_message || "Connected"
                          : "Connection removed"}
                      </span>
                    </span>
                    {!!c.unread && (
                      <span className="unread-count">{c.unread}</span>
                    )}
                  </button>
                );
              })}
            {!conversations.length && (
              <Empty
                icon={<MessageCircle />}
                title="No chats yet"
                description=""
              />
            )}
          </aside>
          <div className="chat-thread">
            {selected ? (
              <>
                <header className="chat-thread-header">
                  <button
                    className="chat-back icon-button"
                    aria-label="Back to chats"
                    onClick={() => setSelected("")}
                  >
                    <ArrowLeft size={23} />
                  </button>
                  <Avatar profile={person} />
                  <div>
                    <strong>{person?.name || "Member"}</strong>
                    {person && onlineIds.includes(person.id) && (
                      <span>Online</span>
                    )}
                  </div>
                  <span
                    className={`delivery-indicator ${live ? "connected" : ""}`}
                    title={live ? "Connected" : "Reconnecting"}
                    aria-label={live ? "Connected" : "Reconnecting"}
                  />
                </header>
                <div
                  className="chat-history"
                  ref={history}
                  onScroll={(e) => {
                    const node = e.currentTarget;
                    stickToBottom.current =
                      node.scrollHeight - node.clientHeight - node.scrollTop <
                      100;
                  }}
                  role="log"
                  aria-label="Messages"
                  aria-live="polite"
                >
                  {older && (
                    <button
                      className="older-messages"
                      onClick={() => void loadOlder()}
                      disabled={loadingOlder}
                    >
                      {loadingOlder ? "Loading…" : "Earlier messages"}
                    </button>
                  )}
                  {messages.map((message, index) => {
                    const mine = message.sender_id === user.id;
                    const date = new Date(
                      message.created_at,
                    ).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    });
                    const previous = index
                      ? new Date(
                          messages[index - 1].created_at,
                        ).toLocaleDateString(undefined, {
                          month: "short",
                          day: "numeric",
                        })
                      : null;
                    return (
                      <div key={message.id}>
                        {date !== previous && (
                          <div className="chat-date">
                            <span>{date}</span>
                          </div>
                        )}
                        <div
                          className={`message-line ${mine ? "outgoing" : ""}`}
                        >
                          <div className="message-bubble">
                            <p>{message.body}</p>
                            <span className="message-stamp">
                              <time dateTime={message.created_at}>
                                {new Date(
                                  message.created_at,
                                ).toLocaleTimeString(undefined, {
                                  hour: "2-digit",
                                  minute: "2-digit",
                                })}
                              </time>
                              {mine && <Check size={17} aria-label="Sent" />}
                            </span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                  <div ref={end} />
                </div>
                {conversation?.can_message ? (
                  <form
                    className="chat-compose"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void send();
                    }}
                  >
                    <textarea
                      aria-label="Message"
                      placeholder="Message"
                      value={body}
                      rows={1}
                      maxLength={2000}
                      onChange={(e) => setBody(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          void send();
                        }
                      }}
                    />
                    <button
                      className="send-message"
                      disabled={sending || !body.trim()}
                      aria-label="Send message"
                    >
                      {sending ? (
                        <Loader2 size={22} className="spin" />
                      ) : (
                        <Send size={22} />
                      )}
                    </button>
                  </form>
                ) : (
                  <div className="chat-readonly" role="status">
                    Connection removed
                  </div>
                )}
              </>
            ) : (
              <Empty icon={<MessageCircle />} title="Messages" description="" />
            )}
          </div>
        </section>
      )}
    </>
  );
}

export function Notifications({
  notifications,
  onRead,
}: {
  notifications: Notification[];
  onRead: () => void;
}) {
  const { user, toast } = useTelos();
  return (
    <div className="notifications-view">
      {!!notifications.length && (
        <div className="notification-toolbar">
          <button
            className="text-button"
            onClick={async () => {
              try {
                await api("notifications", {});
                onRead();
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            <CheckCheck size={20} />
            Mark all read
          </button>
        </div>
      )}
      {!user || !notifications.length ? (
        <Empty icon={<Bell />} title="No notifications" description="" />
      ) : (
        notifications.map((n) => (
          <Link
            href={
              n.href.startsWith("/") && !n.href.startsWith("//")
                ? n.href
                : "/notifications"
            }
            className={`notification-item ${n.read_at ? "" : "unread"}`}
            key={n.id}
          >
            <span className="notification-symbol">
              {n.title.toLowerCase().includes("message") ? (
                <MessageCircle size={25} />
              ) : (
                <Users size={25} />
              )}
            </span>
            <div>
              <strong>{n.title}</strong>
              <p>{n.body}</p>
              <time>
                {new Date(n.created_at).toLocaleString(undefined, {
                  month: "short",
                  day: "numeric",
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </time>
            </div>
          </Link>
        ))
      )}
    </div>
  );
}

export function SettingsView() {
  const { user, profile, refresh, toast } = useTelos();
  const [form, setForm] = useState({
      name: "",
      username: "",
      bio: "",
      city: "",
      state: "",
      country: "",
      interests: "",
      skills: "",
      portfolio: "",
      visibility: "public",
      details: [] as { label: string; value: string }[],
    }),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [password, setPassword] = useState(""),
    [blocks, setBlocks] = useState<{ blocked_id: string }[]>([]);
  useEffect(() => {
    if (profile)
      setForm({
        ...profile,
        state: profile.state || "",
        country: profile.country || "",
        interests: profile.interests.join(", "),
        skills: profile.skills.join(", "),
        details: profile.details || [],
      });
    if (user)
      void api<{ blocked_id: string }[]>("blocks")
        .then(setBlocks)
        .catch((e) => setError(e.message));
  }, [profile, user]);
  const set = (key: Exclude<keyof typeof form, "details">, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));
  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const body = profileSchema.parse({
        ...form,
        interests: form.interests
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        skills: form.skills
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
      });
      await api("profile", body);
      await refresh();
      toast("Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function upload(
    file: File | undefined,
    kind: "avatar_url" | "cover_url",
  ) {
    if (!file || !user || !profile) return;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(file.type) ||
      file.size > 5242880
    ) {
      setError("Choose a JPEG, PNG or WebP under 5 MB.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const image = await createImageBitmap(file);
      const scale = Math.min(
        1,
        (kind === "avatar_url" ? 640 : 1800) /
          Math.max(image.width, image.height),
      );
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.width * scale));
      canvas.height = Math.max(1, Math.round(image.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Image processing unavailable.");
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.close();
      const blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("Invalid image."))),
          "image/webp",
          0.88,
        ),
      );
      const db = browserClient(),
        path = `${user.id}/${kind}-${crypto.randomUUID()}.webp`;
      const result = await db.storage
        .from("profile-media")
        .upload(path, blob, { contentType: "image/webp" });
      if (result.error) throw result.error;
      const url = db.storage.from("profile-media").getPublicUrl(path)
        .data.publicUrl;
      const updated = await db
        .from("profiles")
        .update({ [kind]: url })
        .eq("id", user.id);
      if (updated.error) throw updated.error;
      const old = profile[kind]?.split("/profile-media/")[1];
      if (old?.startsWith(`${user.id}/`))
        await db.storage.from("profile-media").remove([old]);
      await refresh();
      toast("Updated.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!user)
    return (
      <Empty
        icon={<Settings />}
        title="Settings"
        description=""
        action={
          <Link href="/login" className="primary-button">
            Sign in
          </Link>
        }
      />
    );
  return (
    <div className="settings-view">
      <form onSubmit={save}>
        <section className="settings-section">
          <h2>Profile</h2>
          {profile && (
            <div className="profile-media-editor">
              <Avatar profile={profile} size="large" />
              <label className="upload-button">
                <ImagePlus size={20} />
                Photo
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) =>
                    void upload(e.target.files?.[0], "avatar_url")
                  }
                  disabled={busy}
                />
              </label>
              <label className="upload-button">
                <ImagePlus size={20} />
                Cover
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(e) =>
                    void upload(e.target.files?.[0], "cover_url")
                  }
                  disabled={busy}
                />
              </label>
            </div>
          )}
          <label>
            Name
            <input
              required
              minLength={2}
              maxLength={70}
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              autoComplete="name"
            />
          </label>
          <label>
            Username
            <input
              required
              minLength={3}
              maxLength={30}
              pattern="[a-z0-9_]+"
              value={form.username}
              onChange={(e) => set("username", e.target.value.toLowerCase())}
              autoComplete="username"
            />
          </label>
          <label>
            Bio
            <textarea
              rows={3}
              maxLength={600}
              value={form.bio}
              onChange={(e) => set("bio", e.target.value)}
            />
          </label>
          <fieldset className="profile-location-fields">
            <legend>Location</legend>
            <div className="form-grid">
              <label>
                City
                <input
                  value={form.city}
                  maxLength={100}
                  autoComplete="address-level2"
                  onChange={(e) => set("city", e.target.value)}
                />
              </label>
              <label>
                State
                <input
                  value={form.state}
                  maxLength={100}
                  autoComplete="address-level1"
                  onChange={(e) => set("state", e.target.value)}
                />
              </label>
              <label>
                Country
                <input
                  value={form.country}
                  maxLength={100}
                  autoComplete="country-name"
                  onChange={(e) => set("country", e.target.value)}
                />
              </label>
            </div>
          </fieldset>
          <label>
            Interests
            <input
              value={form.interests}
              onChange={(e) => set("interests", e.target.value)}
            />
          </label>
          <label>
            Skills
            <input
              value={form.skills}
              onChange={(e) => set("skills", e.target.value)}
            />
          </label>
          <label>
            Website
            <input
              type="url"
              value={form.portfolio}
              onChange={(e) => set("portfolio", e.target.value)}
              placeholder="https://"
            />
          </label>
          <div className="custom-profile-fields">
            <h3>Details</h3>
            {form.details.map((field, index) => (
              <div className="custom-profile-row" key={index}>
                <input
                  aria-label={`Detail label ${index + 1}`}
                  placeholder="Label"
                  maxLength={40}
                  required
                  value={field.label}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      details: f.details.map((item, i) =>
                        i === index ? { ...item, label: e.target.value } : item,
                      ),
                    }))
                  }
                />
                <input
                  aria-label={`Detail value ${index + 1}`}
                  placeholder="Value"
                  maxLength={200}
                  value={field.value}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      details: f.details.map((item, i) =>
                        i === index ? { ...item, value: e.target.value } : item,
                      ),
                    }))
                  }
                />
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Remove detail"
                  onClick={() =>
                    setForm((f) => ({
                      ...f,
                      details: f.details.filter((_, i) => i !== index),
                    }))
                  }
                >
                  <X size={20} />
                </button>
              </div>
            ))}
            <button
              type="button"
              className="secondary-button"
              disabled={form.details.length >= 10}
              onClick={() =>
                setForm((f) => ({
                  ...f,
                  details: [...f.details, { label: "", value: "" }],
                }))
              }
            >
              <Plus size={18} />
              Add detail
            </button>
          </div>
          <label>
            Visibility
            <select
              value={form.visibility}
              onChange={(e) => set("visibility", e.target.value)}
            >
              <option value="public">Everyone on Telos</option>
              <option value="connections">Connections</option>
            </select>
          </label>
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
          <button className="primary-button" disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </section>
      </form>
      <section className="settings-section">
        <h2>Blocked accounts</h2>
        {blocks.map((b) => (
          <div className="blocked-account" key={b.blocked_id}>
            <span>{b.blocked_id.slice(0, 8)}</span>
            <button
              className="secondary-button"
              onClick={async () => {
                try {
                  await api("block", { id: b.blocked_id, blocked: false });
                  setBlocks((all) =>
                    all.filter((v) => v.blocked_id !== b.blocked_id),
                  );
                } catch (e) {
                  toast((e as Error).message);
                }
              }}
            >
              Unblock
            </button>
          </div>
        ))}
        {!blocks.length && <p>None</p>}
      </section>
      <section className="settings-section">
        <h2>Account</h2>
        <p className="account-email">{user.email}</p>
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const { error } = await browserClient().auth.updateUser({
                password,
              });
              if (error) throw error;
              setPassword("");
              toast("Password updated.");
            } catch (e) {
              toast((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label>
            New password
            <input
              type="password"
              autoComplete="new-password"
              minLength={10}
              maxLength={128}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </label>
          <button className="secondary-button" disabled={busy}>
            Update password
          </button>
        </form>
        <button
          className="danger-link"
          onClick={async () => {
            const { error } = await browserClient().auth.signOut();
            if (error) toast(error.message);
            else window.location.assign("/");
          }}
        >
          <LogOut size={20} />
          Sign out
        </button>
      </section>
    </div>
  );
}
