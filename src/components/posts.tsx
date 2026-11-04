"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Bookmark,
  Heart,
  ImagePlus,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Send,
  Trash2,
  X,
} from "lucide-react";
import { api } from "@/lib/api";
import { browserClient } from "@/lib/supabase/client";
import { preparePhoto } from "@/lib/media";
import type { PostComment, Profile, SocialPost } from "@/lib/types";
import { useTelos } from "./provider";
import { Avatar, Empty, Modal } from "./ui";

export function PostComposer({
  close,
  onSave,
  existing,
  initialText = "",
}: {
  close: () => void;
  onSave: () => void;
  existing?: SocialPost;
  initialText?: string;
}) {
  const { user, profile, toast } = useTelos();
  const [body, setBody] = useState(existing?.body || initialText),
    [audience, setAudience] = useState<"public" | "connections">(
      existing?.visibility || "public",
    ),
    [kept, setKept] = useState(existing?.media_paths || []),
    [files, setFiles] = useState<{ file: File; url: string }[]>([]),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const previews = useRef<string[]>([]),
    fileInput = useRef<HTMLInputElement>(null);
  useEffect(
    () => () => {
      previews.current.forEach((url) => URL.revokeObjectURL(url));
    },
    [],
  );
  function addFiles(list: FileList | null) {
    if (!list) return;
    setError("");
    const picked = [...list];
    if (picked.length + files.length + kept.length > 4) {
      setError("Up to 4 photos.");
      return;
    }
    if (
      picked.some(
        (f) =>
          !["image/jpeg", "image/png", "image/webp"].includes(f.type) ||
          f.size > 5242880,
      )
    ) {
      setError("Choose JPEG, PNG or WebP photos under 5 MB.");
      return;
    }
    const added = picked.map((file) => ({
      file,
      url: URL.createObjectURL(file),
    }));
    previews.current.push(...added.map((f) => f.url));
    setFiles((old) => [...old, ...added]);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    const uploaded: string[] = [];
    let publishing = false;
    try {
      const db = browserClient();
      for (const item of files) {
        const blob = await preparePhoto(item.file),
          path = `${user.id}/${crypto.randomUUID()}.webp`;
        const result = await db.storage
          .from("post-media")
          .upload(path, blob, { contentType: "image/webp" });
        if (result.error) throw result.error;
        uploaded.push(path);
      }
      publishing = true;
      await api("posts", {
        id: existing?.id,
        body,
        media_paths: [...kept, ...uploaded],
        visibility: audience,
      });
      onSave();
      close();
      toast(existing ? "Updated." : "Posted.");
    } catch (e) {
      if (uploaded.length && !publishing)
        await browserClient().storage.from("post-media").remove(uploaded);
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={existing ? "Edit post" : "New post"}
      close={close}
      busy={busy}
      wide
    >
      <form onSubmit={submit} className="social-compose">
        <div className="composer-author">
          <Avatar profile={profile} />
          <strong>{profile?.name}</strong>
        </div>
        <textarea
          className="intent-editor"
          aria-label="Post text"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          maxLength={5000}
          rows={4}
          placeholder="Share something…"
        />
        <div className="compose-photo-grid">
          {kept.map((path) => (
            <div key={path}>
              {existing?.media_urls[existing.media_paths.indexOf(path)] && (
                <img
                  src={existing.media_urls[existing.media_paths.indexOf(path)]}
                  alt="Attached photo"
                />
              )}
              <button
                type="button"
                aria-label="Remove photo"
                disabled={busy}
                onClick={() => setKept((k) => k.filter((p) => p !== path))}
              >
                <X size={18} />
              </button>
            </div>
          ))}
          {files.map((item, index) => (
            <div key={item.url}>
              <img src={item.url} alt="Photo preview" />
              <button
                type="button"
                aria-label="Remove photo"
                disabled={busy}
                onClick={() => {
                  URL.revokeObjectURL(item.url);
                  setFiles((f) => f.filter((_, i) => i !== index));
                }}
              >
                <X size={18} />
              </button>
            </div>
          ))}
        </div>
        <div className="composer-tools">
          <input
            className="sr-only"
            type="file"
            ref={fileInput}
            accept="image/jpeg,image/png,image/webp"
            multiple
            onChange={(e) => {
              addFiles(e.target.files);
              e.target.value = "";
            }}
            aria-label="Add photos"
            disabled={busy || files.length + kept.length >= 4}
          />
          <button
            type="button"
            className="secondary-button"
            disabled={busy || files.length + kept.length >= 4}
            onClick={() => fileInput.current?.click()}
          >
            <ImagePlus size={20} />
            Photo
          </button>
          <label className="audience-picker">
            <span className="sr-only">Audience</span>
            <select
              value={audience}
              onChange={(e) => setAudience(e.target.value as typeof audience)}
            >
              <option value="public">Everyone</option>
              <option value="connections">Connections</option>
            </select>
          </label>
        </div>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="modal-actions">
          <button
            className="primary-button"
            disabled={busy || (!body.trim() && !files.length && !kept.length)}
          >
            {busy ? (
              <Loader2 className="spin" size={20} />
            ) : existing ? (
              "Save"
            ) : (
              "Post"
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}

export function SocialPostCard({
  post,
  onProfile,
  onRefresh,
  onEdit,
  onReport,
}: {
  post: SocialPost;
  onProfile: (p: Profile) => void;
  onRefresh: () => void;
  onEdit: (p: SocialPost) => void;
  onReport: (p: SocialPost) => void;
}) {
  const { user, toast } = useTelos();
  const [menu, setMenu] = useState(false),
    [pending, setPending] = useState(""),
    [comments, setComments] = useState(false),
    [photo, setPhoto] = useState<string | null>(null);
  async function toggle(action: "like" | "saved") {
    setPending(action);
    try {
      await api(
        action,
        action === "like"
          ? { id: post.id, liked: !post.liked }
          : { id: post.id, saved: !post.saved },
      );
      onRefresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setPending("");
    }
  }
  return (
    <article className="community-post">
      <header>
        <Avatar
          profile={post.profile}
          onClick={() => onProfile(post.profile)}
        />
        <button
          className="community-author"
          onClick={() => onProfile(post.profile)}
        >
          <strong>{post.profile.name}</strong>
          {post.profile.is_demo && <span className="demo-badge">Demo bot</span>}
          <span>
            {new Date(post.created_at).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
            })}
            {post.visibility === "connections" ? " · Connections" : ""}
          </span>
        </button>
        <div className="post-menu">
          <button
            className="icon-button"
            aria-label="Post options"
            aria-expanded={menu}
            onClick={() => setMenu((v) => !v)}
          >
            <MoreHorizontal size={22} />
          </button>
          {menu && (
            <>
              <button
                className="menu-dismiss"
                aria-label="Close options"
                onClick={() => setMenu(false)}
              />
              <div className="dropdown-menu">
                {post.user_id === user?.id ? (
                  <>
                    <button
                      onClick={() => {
                        setMenu(false);
                        onEdit(post);
                      }}
                    >
                      Edit
                    </button>
                    <button
                      className="danger-link"
                      onClick={async () => {
                        setMenu(false);
                        if (!window.confirm("Delete this post?")) return;
                        try {
                          await api("delete-post", { id: post.id });
                          onRefresh();
                        } catch (e) {
                          toast((e as Error).message);
                        }
                      }}
                    >
                      Delete
                    </button>
                  </>
                ) : (
                  <button
                    onClick={() => {
                      setMenu(false);
                      onReport(post);
                    }}
                  >
                    Report or block
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </header>
      {post.body && <p className="community-post-text">{post.body}</p>}
      {post.media_urls.some(Boolean) && (
        <div
          className={`post-gallery gallery-${post.media_urls.filter(Boolean).length}`}
        >
          {post.media_urls.filter(Boolean).map((url, index) => (
            <button
              key={url}
              onClick={() => setPhoto(url)}
              aria-label={`Open photo ${index + 1}`}
            >
              <img
                src={url}
                alt={`Photo by ${post.profile.name}`}
                loading="lazy"
              />
            </button>
          ))}
        </div>
      )}
      <footer>
        <button
          className={post.liked ? "liked" : ""}
          disabled={pending === "like"}
          onClick={() => void toggle("like")}
          aria-label={post.liked ? "Unlike" : "Like"}
          aria-pressed={post.liked}
        >
          <Heart size={22} fill={post.liked ? "currentColor" : "none"} />
          {post.like_count > 0 && <span>{post.like_count}</span>}
        </button>
        <button onClick={() => setComments(true)} aria-label="Comments">
          <MessageCircle size={22} />
          {post.comment_count > 0 && <span>{post.comment_count}</span>}
        </button>
        <button
          className={post.saved ? "saved" : ""}
          disabled={pending === "saved"}
          onClick={() => void toggle("saved")}
          aria-label={post.saved ? "Unsave post" : "Save post"}
          aria-pressed={post.saved}
        >
          <Bookmark size={22} fill={post.saved ? "currentColor" : "none"} />
        </button>
      </footer>
      {comments && (
        <Comments
          post={post}
          close={() => setComments(false)}
          onRefresh={onRefresh}
        />
      )}
      {photo && (
        <Modal title="Photo" close={() => setPhoto(null)} wide>
          <img
            className="expanded-photo"
            src={photo}
            alt={`Photo by ${post.profile.name}`}
          />
        </Modal>
      )}
    </article>
  );
}

function Comments({
  post,
  close,
  onRefresh,
}: {
  post: SocialPost;
  close: () => void;
  onRefresh: () => void;
}) {
  const { user, profile, toast } = useTelos();
  const [rows, setRows] = useState<PostComment[]>([]),
    [body, setBody] = useState(""),
    [busy, setBusy] = useState(false),
    [loading, setLoading] = useState(true),
    [more, setMore] = useState(false),
    [error, setError] = useState("");
  const load = useCallback(async () => {
    try {
      const comments = await api<PostComment[]>(`comments?post=${post.id}`);
      setRows(comments);
      setMore(comments.length === 50);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [post.id]);
  useEffect(() => {
    void load();
    const db = browserClient();
    let timer: ReturnType<typeof setTimeout>;
    const channel = db
      .channel(`comments-${post.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "feed_events" },
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
  }, [load, post.id]);
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    try {
      await api("comments", { post_id: post.id, body });
      setBody("");
      await load();
      onRefresh();
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="Comments" close={close} wide>
      <div className="comments-list">
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {loading ? (
          <Loader2 className="spin" />
        ) : (
          rows.map((row) => (
            <article key={row.id}>
              <Avatar profile={row.profile} />
              <div>
                <strong>{row.profile.name}</strong>
                <p>{row.body}</p>
              </div>
              {row.user_id === user?.id && (
                <button
                  className="icon-button"
                  aria-label="Delete comment"
                  onClick={async () => {
                    try {
                      await api("delete-comment", { id: row.id });
                      await load();
                      onRefresh();
                    } catch (e) {
                      toast((e as Error).message);
                    }
                  }}
                >
                  <Trash2 size={18} />
                </button>
              )}
            </article>
          ))
        )}
        {!loading && !rows.length && !error && (
          <Empty
            icon={<MessageCircle />}
            title="No comments yet"
            description=""
          />
        )}
        {more && (
          <button
            className="text-button"
            onClick={async () => {
              try {
                const next = await api<PostComment[]>(
                  `comments?post=${post.id}&offset=${rows.length}`,
                );
                setRows((old) => [...old, ...next]);
                setMore(next.length === 50);
              } catch (e) {
                toast((e as Error).message);
              }
            }}
          >
            Show more
          </button>
        )}
      </div>
      <form className="comment-compose" onSubmit={submit}>
        <Avatar profile={profile} />
        <textarea
          rows={2}
          aria-label="Comment"
          placeholder="Write a comment…"
          required
          maxLength={1000}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
        <button
          disabled={busy || !body.trim()}
          className="icon-button"
          aria-label="Send comment"
        >
          {busy ? <Loader2 className="spin" size={21} /> : <Send size={21} />}
        </button>
      </form>
    </Modal>
  );
}
