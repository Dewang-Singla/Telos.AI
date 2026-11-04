"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  Bell,
  Bookmark,
  ImagePlus,
  LayoutGrid,
  Loader2,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Send,
  Settings,
  Users,
  UserRound,
  Handshake,
  X,
  type LucideIcon,
} from "lucide-react";
import { api } from "@/lib/api";
import { browserClient } from "@/lib/supabase/client";
import type {
  Intent,
  Notification,
  Profile,
  SocialPost,
  Relationship,
} from "@/lib/types";
import { useTelos } from "./provider";
import { Avatar, Empty, Loading, Logo, Modal } from "./ui";
import { FindPeople } from "./find-people";
import { SearchView } from "./search-view";
import { PostComposer, SocialPostCard } from "./posts";
import {
  Connections,
  Messages,
  Notifications,
  ProfileView,
  SettingsView,
} from "./views";

const navigation: {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}[] = [
  { id: "find", label: "Find people", href: "/find", icon: Search },
  { id: "home", label: "Feed", href: "/feed", icon: LayoutGrid },
  { id: "messages", label: "Messages", href: "/messages", icon: MessageCircle },
  {
    id: "connections",
    label: "Connections",
    href: "/connections",
    icon: Handshake,
  },
  {
    id: "notifications",
    label: "Notifications",
    href: "/notifications",
    icon: Bell,
  },
  { id: "saved", label: "Saved", href: "/saved", icon: Bookmark },
  { id: "profile", label: "Profile", href: "/profile", icon: UserRound },
];
const pageNames: Record<string, string> = {
  home: "Feed",
  find: "Find people",
  matches: "Find people",
  nearby: "Find people",
  search: "Search",
  messages: "Messages",
  connections: "Connections",
  notifications: "Notifications",
  saved: "Saved",
  profile: "Profile",
  settings: "Settings",
};
type ReportTarget = { profile: Profile; post?: SocialPost };

export function Telos({
  section,
  initialQuery = "",
  initialSearchTab = "people",
}: {
  section: string;
  initialQuery?: string;
  initialSearchTab?: "people" | "posts";
}) {
  const {
    user,
    profile,
    loading: sessionLoading,
    error: sessionError,
    toast,
    relationshipRevision,
    relationshipsChanged,
    refresh: refreshSession,
  } = useTelos();
  const profileRequest = useRef(0),
    feedRequest = useRef(0);
  const [feedScope, setFeedScope] = useState("all");
  const [mobileNav, setMobileNav] = useState(false),
    [revision, setRevision] = useState(0),
    [posts, setPosts] = useState<SocialPost[]>([]),
    [notifications, setNotifications] = useState<Notification[]>([]),
    [mine, setMine] = useState<Intent[]>([]),
    [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [error, setError] = useState("");
  const [draft, setDraft] = useState(""),
    [compose, setCompose] = useState(false),
    [editPost, setEditPost] = useState<SocialPost | undefined>(),
    [selectedProfile, setSelectedProfile] = useState<Profile | null>(null),
    [selectedIntents, setSelectedIntents] = useState<Intent[]>([]),
    [contact, setContact] = useState<{
      profile: Profile;
      sourceId?: string;
    } | null>(null),
    [note, setNote] = useState(""),
    [sending, setSending] = useState(false),
    [report, setReport] = useState<ReportTarget | null>(null),
    [reason, setReason] = useState("");
  const isFind = ["find", "matches", "nearby"].includes(section),
    isFeed = section === "home" || section === "saved",
    wide = isFind || section === "messages" || section === "settings";
  const refresh = useCallback(() => setRevision((r) => r + 1), []);
  const selectedProfileId = selectedProfile?.id;
  useEffect(() => {
    if (!user || !selectedProfileId) return;
    let cancelled = false;
    void api<Profile | null>(`profile?id=${selectedProfileId}`)
      .then((latest) => {
        if (cancelled) return;
        setSelectedProfile(latest);
        if (!latest) setSelectedIntents([]);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [user, selectedProfileId, relationshipRevision]);
  const loadFeed = useCallback(
    async (offset = 0, quiet = false) => {
      const version = ++feedRequest.current;
      if (!user || !isFeed) {
        setPosts([]);
        return;
      }
      if (!quiet) setLoading(true);
      setError("");
      try {
        const rows = await api<SocialPost[]>(
          `${section === "saved" ? "saved" : "posts"}?offset=${offset}&scope=${section === "saved" ? "all" : feedScope}`,
        );
        if (version !== feedRequest.current) return;
        setPosts((old) =>
          offset
            ? [...old, ...rows.filter((p) => !old.some((o) => o.id === p.id))]
            : rows,
        );
        setMore(rows.length === 20);
      } catch (e) {
        if (version === feedRequest.current) setError((e as Error).message);
      } finally {
        if (version === feedRequest.current) setLoading(false);
      }
    },
    [user, isFeed, section, feedScope],
  );
  useEffect(() => {
    if (sessionLoading) return;
    void loadFeed();
  }, [sessionLoading, loadFeed, revision, relationshipRevision]);
  useEffect(() => {
    if (!user) {
      setNotifications([]);
      setMine([]);
      setSelectedProfile(null);
      setSelectedIntents([]);
      setContact(null);
      return;
    }
    let cancelled = false;
    void Promise.all([
      api<Notification[]>("notifications"),
      api<Intent[]>("intents"),
    ])
      .then(([notes, intents]) => {
        if (!cancelled) {
          setNotifications(notes);
          setMine(intents);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, [user, revision]);
  useEffect(() => {
    if (!user) return;
    const db = browserClient();
    let timer: ReturnType<typeof setTimeout>;
    const update = () => {
      clearTimeout(timer);
      timer = setTimeout(() => void loadFeed(0, true), 350);
    };
    const channel = db
      .channel(`community-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "feed_events" },
        update,
      )
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (p) =>
          setNotifications((old) =>
            old.some((n) => n.id === p.new.id)
              ? old
              : [p.new as Notification, ...old],
          ),
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") update();
      });
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") update();
    }, 60000);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      void db.removeChannel(channel);
    };
  }, [user, loadFeed]);
  function openPost(post?: SocialPost) {
    if (!user) {
      window.location.assign("/login");
      return;
    }
    if (!profile) {
      window.location.assign("/settings");
      return;
    }
    setEditPost(post);
    setCompose(true);
  }
  async function connect(person: Profile, sourceId?: string) {
    if (!user) {
      window.location.assign("/login");
      return;
    }
    if (!profile) {
      window.location.assign("/settings");
      return;
    }
    try {
      const state = await api<Relationship>(`relationship?id=${person.id}`);
      if (state.connection === "connected") {
        window.location.assign(
          state.conversation_id
            ? `/messages?conversation=${state.conversation_id}`
            : "/messages",
        );
        return;
      }
      if (state.connection === "received") {
        window.location.assign("/connections");
        return;
      }
      if (state.connection === "sent") {
        toast("Request pending.");
        return;
      }
    } catch (e) {
      toast((e as Error).message);
      return;
    }
    setNote("");
    setContact({ profile: person, sourceId });
  }
  async function viewProfile(person: Profile) {
    const version = ++profileRequest.current;
    setSelectedProfile(person);
    setSelectedIntents([]);
    if (user) {
      try {
        const rows = await api<Intent[]>(`intents?user=${person.id}`);
        if (version === profileRequest.current) setSelectedIntents(rows);
      } catch (e) {
        toast((e as Error).message);
      }
    }
  }
  const renderPost = (post: SocialPost) => (
    <SocialPostCard
      key={post.id}
      post={post}
      onProfile={(p) => void viewProfile(p)}
      onRefresh={refresh}
      onEdit={openPost}
      onReport={(p) => {
        setReport({ profile: p.profile, post: p });
        setReason("");
      }}
    />
  );
  const unread = notifications.filter((n) => !n.read_at).length;
  return (
    <div className={`social-app ${isFind ? "search-app" : ""}`}>
      <aside className={`app-sidebar ${mobileNav ? "is-open" : ""}`}>
        <Link href="/" className="app-logo" aria-label="Telos">
          <Logo />
        </Link>
        <button
          className="sidebar-close icon-button"
          aria-label="Close menu"
          onClick={() => setMobileNav(false)}
        >
          <X />
        </button>
        <nav>
          {navigation.map((item) => (
            <Link
              href={item.href}
              key={item.id}
              className={
                (item.id === "find" ? isFind : section === item.id)
                  ? "selected"
                  : ""
              }
              onClick={() => setMobileNav(false)}
            >
              <item.icon
                size={25}
                strokeWidth={
                  (item.id === "find" ? isFind : section === item.id)
                    ? 2.5
                    : 1.8
                }
              />
              <span>{item.label}</span>
              {item.id === "notifications" && unread > 0 && (
                <b className="nav-badge">{unread}</b>
              )}
            </Link>
          ))}
        </nav>
        <div className="sidebar-account">
          {user ? (
            <>
              <Link href="/profile" className="account-link">
                <Avatar profile={profile} />
                <span>
                  <strong>{profile?.name || "Your profile"}</strong>
                  <span>@{profile?.username || "new_user"}</span>
                </span>
              </Link>
              <Link
                href="/settings"
                className="icon-button"
                aria-label="Settings"
              >
                <Settings size={21} />
              </Link>
            </>
          ) : (
            <Link href="/login" className="primary-button full">
              Sign in
            </Link>
          )}
        </div>
      </aside>
      <div
        className={`social-layout ${wide ? "wide-layout" : ""} ${section === "messages" ? "message-layout" : ""}`}
      >
        <main className={`timeline ${isFind ? "find-page" : ""}`}>
          <header className="timeline-header">
            <div>
              <button
                className="mobile-menu icon-button"
                aria-label="Open menu"
                onClick={() => setMobileNav(true)}
              >
                <Menu />
              </button>
              <h1>
                {section === "profile" && profile
                  ? profile.name
                  : pageNames[section]}
              </h1>
            </div>
            {section !== "search" && (
              <>
                <form
                  action="/search"
                  method="get"
                  role="search"
                  className="global-search"
                >
                  <input
                    type="search"
                    name="q"
                    aria-label="Search people or posts"
                    placeholder="Search"
                    maxLength={200}
                    required
                  />
                  <button
                    type="submit"
                    className="icon-button"
                    aria-label="Search"
                  >
                    <Search size={21} />
                  </button>
                </form>
                <Link
                  href="/search"
                  className="icon-button header-search-icon"
                  aria-label="Search"
                >
                  <Search size={23} />
                </Link>
              </>
            )}
            {isFeed && (
              <button
                className="icon-button"
                aria-label="New post"
                onClick={() => openPost()}
              >
                <Plus size={24} />
              </button>
            )}
            {section === "settings" && (
              <Link
                href="/profile"
                className="icon-button"
                aria-label="Back to profile"
              >
                <ArrowLeft size={23} />
              </Link>
            )}
          </header>
          {user && !profile && !sessionLoading && (
            <div className="setup-profile">
              <Link href="/settings">
                Complete your profile <Send size={17} />
              </Link>
            </div>
          )}
          {(error || sessionError) && (
            <div className="error-box" role="alert">
              {sessionError || error}
              <button
                onClick={() => {
                  refresh();
                  void refreshSession();
                }}
              >
                Retry
              </button>
            </div>
          )}
          {isFind && (
            <FindPeople
              initialNearby={section === "nearby"}
              onProfile={(p) => void viewProfile(p)}
              onConnect={connect}
              onReport={(p) => {
                setReport({ profile: p });
                setReason("");
              }}
              revision={revision}
            />
          )}
          {isFeed && (
            <>
              {section === "home" && (
                <div className="timeline-tabs feed-tabs" aria-label="Feed view">
                  {[
                    ["all", "All"],
                    ["following", "Following"],
                    ["connections", "Connections"],
                  ].map(([id, label]) => (
                    <button
                      key={id}
                      className={feedScope === id ? "selected" : ""}
                      aria-pressed={feedScope === id}
                      onClick={() => {
                        if (feedScope === id) return;
                        feedRequest.current++;
                        setPosts([]);
                        setMore(false);
                        setLoading(true);
                        setFeedScope(id);
                      }}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
              {section === "home" && (
                <section className="community-inline-composer">
                  <Avatar profile={profile} />
                  <div>
                    <textarea
                      aria-label="Post text"
                      placeholder="Share something…"
                      rows={2}
                      maxLength={5000}
                      value={draft}
                      onChange={(e) => setDraft(e.target.value)}
                    />
                    <div>
                      <button
                        className="text-button"
                        onClick={() => openPost()}
                      >
                        <ImagePlus size={21} />
                        Photo
                      </button>
                      <button
                        className="primary-button"
                        onClick={() => openPost()}
                      >
                        Post
                      </button>
                    </div>
                  </div>
                </section>
              )}
              <div className="community-feed">
                {sessionLoading || (loading && !posts.length) ? (
                  <Loading />
                ) : (
                  posts.map(renderPost)
                )}
                {!sessionLoading && !loading && !posts.length && (
                  <Empty
                    icon={section === "saved" ? <Bookmark /> : <LayoutGrid />}
                    title={
                      section === "saved" ? "No saved posts" : "No posts yet"
                    }
                    description=""
                    action={
                      section === "home" ? (
                        <button
                          className="primary-button"
                          onClick={() => openPost()}
                        >
                          New post
                        </button>
                      ) : undefined
                    }
                  />
                )}
              </div>
              {more && (
                <button
                  className="load-more"
                  disabled={loading}
                  onClick={() => void loadFeed(posts.length)}
                >
                  Show more
                </button>
              )}
            </>
          )}
          {section === "search" && (
            <SearchView
              key={`${initialQuery}:${initialSearchTab}`}
              initialQuery={initialQuery}
              initialTab={initialSearchTab}
              revision={revision}
              onProfile={(p) => void viewProfile(p)}
              renderPost={renderPost}
            />
          )}
          {section === "messages" && <Messages />}
          {section === "connections" && (
            <Connections
              openProfile={(p) => void viewProfile(p)}
              refreshParent={refresh}
            />
          )}
          {section === "notifications" && (
            <Notifications
              notifications={notifications}
              onRead={() =>
                setNotifications((old) =>
                  old.map((n) => ({ ...n, read_at: new Date().toISOString() })),
                )
              }
            />
          )}
          {section === "settings" && <SettingsView />}
          {section === "profile" &&
            (profile ? (
              <ProfileView
                profile={profile}
                intents={mine}
                own
                onConnect={() => {}}
                onEdit={() => {}}
                onProfile={(p) => void viewProfile(p)}
                onReport={(p) => {
                  setReport({ profile: p.profile, post: p });
                  setReason("");
                }}
              />
            ) : (
              <Empty
                icon={<Users />}
                title="Your profile"
                description=""
                action={
                  <Link
                    href={user ? "/settings" : "/login"}
                    className="primary-button"
                  >
                    {user ? "Edit profile" : "Sign in"}
                  </Link>
                }
              />
            ))}
        </main>
        {!wide && (
          <aside className="context-sidebar">
            <section className="context-card find-shortcut">
              <span className="shortcut-icon">
                <Search size={28} />
              </span>
              <h2>Find people</h2>
              <Link href="/find" className="primary-button full">
                New search
              </Link>
            </section>
            {profile && (
              <section className="context-card profile-preview">
                <Avatar profile={profile} size="large" />
                <Link href="/profile">
                  <h2>{profile.name}</h2>
                  <span>@{profile.username}</span>
                </Link>
                {profile.bio && <p>{profile.bio}</p>}
                <Link href="/settings" className="secondary-button">
                  Edit profile
                </Link>
              </section>
            )}
            {!user && (
              <section className="context-card sign-in-card">
                <h2>Join Telos</h2>
                <Link href="/signup" className="primary-button full">
                  Create account
                </Link>
                <Link href="/login" className="secondary-button full">
                  Sign in
                </Link>
              </section>
            )}
            <Link href="/settings" className="rail-settings">
              <Settings size={19} />
              Settings
            </Link>
          </aside>
        )}
      </div>
      <nav className="mobile-bottom-nav">
        {navigation
          .filter((item) =>
            ["home", "find", "messages", "profile"].includes(item.id),
          )
          .map((item) => (
            <Link
              href={item.href}
              key={item.id}
              aria-label={item.label}
              className={
                (item.id === "find" ? isFind : section === item.id)
                  ? "active"
                  : ""
              }
            >
              <item.icon size={25} />
            </Link>
          ))}
        <button aria-label="New post" onClick={() => openPost()}>
          <Plus size={26} />
        </button>
      </nav>
      {compose && (
        <PostComposer
          existing={editPost}
          initialText={draft}
          close={() => {
            setCompose(false);
            setEditPost(undefined);
          }}
          onSave={() => {
            setDraft("");
            refresh();
          }}
        />
      )}
      {selectedProfile && (
        <Modal title="Profile" close={() => setSelectedProfile(null)} wide>
          <ProfileView
            key={selectedProfile.id}
            profile={selectedProfile}
            intents={selectedIntents}
            own={selectedProfile.id === user?.id}
            onEdit={() => {}}
            onConnect={() => {
              connect(selectedProfile);
              setSelectedProfile(null);
            }}
            onProfile={(p) => void viewProfile(p)}
            onReport={(p) => {
              setReport({ profile: p.profile, post: p });
              setReason("");
            }}
          />
        </Modal>
      )}
      {contact && (
        <Modal title="Connect" close={() => setContact(null)} busy={sending}>
          <div className="contact-heading">
            <Avatar profile={contact.profile} />
            <strong>{contact.profile.name}</strong>
          </div>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSending(true);
              try {
                const result = await api<{
                  conversation_id?: string;
                  pending?: boolean;
                }>("connections", {
                  recipient_id: contact.profile.id,
                  source_intent_id: contact.sourceId ?? null,
                  note: note.trim() || "I’d like to connect.",
                });
                setContact(null);
                relationshipsChanged();
                if (result.conversation_id)
                  window.location.assign(
                    `/messages?conversation=${result.conversation_id}`,
                  );
                else
                  toast(result.pending ? "Request pending." : "Request sent.");
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setSending(false);
              }
            }}
          >
            <textarea
              aria-label="Connection message"
              placeholder="Message (optional)"
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
            <div className="modal-actions">
              <button className="primary-button" disabled={sending}>
                {sending ? <Loader2 className="spin" size={21} /> : "Connect"}
              </button>
            </div>
          </form>
        </Modal>
      )}
      {report && (
        <Modal title="Report" close={() => setReport(null)}>
          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setSending(true);
              try {
                await api("report", {
                  target_id: report.profile.id,
                  post_id: report.post?.id ?? null,
                  reason,
                });
                setReport(null);
                toast("Report submitted.");
              } catch (e) {
                toast((e as Error).message);
              } finally {
                setSending(false);
              }
            }}
          >
            <textarea
              aria-label="Report reason"
              placeholder="Reason"
              required
              minLength={10}
              maxLength={1000}
              rows={4}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
            <div className="modal-actions">
              <button
                type="button"
                className="danger-link"
                onClick={async () => {
                  try {
                    await api("block", {
                      id: report.profile.id,
                      blocked: true,
                    });
                    setReport(null);
                    setSelectedProfile(null);
                    refresh();
                    relationshipsChanged();
                    toast("Blocked.");
                  } catch (e) {
                    toast((e as Error).message);
                  }
                }}
              >
                Block user
              </button>
              <button className="primary-button" disabled={sending}>
                Submit
              </button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
