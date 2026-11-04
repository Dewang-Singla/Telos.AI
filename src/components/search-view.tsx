"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { api } from "@/lib/api";
import type { Profile, SocialPost } from "@/lib/types";
import { useTelos } from "./provider";
import { Avatar, Empty, Loading } from "./ui";

export function SearchView({
  initialQuery = "",
  initialTab = "people",
  revision,
  onProfile,
  renderPost,
}: {
  initialQuery?: string;
  initialTab?: "people" | "posts";
  revision: number;
  onProfile: (profile: Profile) => void;
  renderPost: (post: SocialPost) => ReactNode;
}) {
  const { user, loading: sessionLoading, relationshipRevision } = useTelos();
  const [query, setQuery] = useState(initialQuery),
    [tab, setTab] = useState(initialTab);
  const [people, setPeople] = useState<Profile[]>([]),
    [posts, setPosts] = useState<SocialPost[]>([]);
  const [loading, setLoading] = useState(false),
    [more, setMore] = useState(false),
    [error, setError] = useState("");
  const sequence = useRef(0),
    input = useRef<HTMLInputElement>(null);
  const invalidate = useCallback(() => {
    sequence.current++;
  }, []);
  const term = query.trim();
  const load = useCallback(
    async (offset = 0) => {
      if (!user || !term) return;
      const version = ++sequence.current;
      setLoading(true);
      try {
        const url = `${tab}?q=${encodeURIComponent(term)}&offset=${offset}`;
        if (tab === "people") {
          const rows = await api<Profile[]>(url);
          if (version !== sequence.current) return;
          setPeople((old) =>
            offset
              ? [...old, ...rows.filter((r) => !old.some((p) => p.id === r.id))]
              : rows,
          );
          setMore(rows.length === 40);
        } else {
          const rows = await api<SocialPost[]>(url);
          if (version !== sequence.current) return;
          setPosts((old) =>
            offset
              ? [...old, ...rows.filter((r) => !old.some((p) => p.id === r.id))]
              : rows,
          );
          setMore(rows.length === 20);
        }
        setError("");
      } catch (e) {
        if (version === sequence.current) setError((e as Error).message);
      } finally {
        if (version === sequence.current) setLoading(false);
      }
    },
    [user, tab, term],
  );
  useEffect(() => {
    const url = new URL(window.location.href);
    if (term) url.searchParams.set("q", term);
    else url.searchParams.delete("q");
    url.searchParams.set("tab", tab);
    window.history.replaceState(null, "", `${url.pathname}${url.search}`);
  }, [term, tab]);
  useEffect(() => {
    setPeople([]);
    setPosts([]);
    setMore(false);
    setError("");
    if (!user || !term || sessionLoading) {
      setLoading(false);
      return invalidate;
    }
    setLoading(true);
    const timer = setTimeout(() => void load(), 250);
    return () => {
      clearTimeout(timer);
      invalidate();
    };
  }, [
    load,
    term,
    user,
    sessionLoading,
    revision,
    relationshipRevision,
    invalidate,
  ]);
  return (
    <section className="unified-search">
      <form
        className="explore-search"
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          if (term) void load();
        }}
      >
        <Search size={22} />
        <input
          ref={input}
          type="search"
          aria-label="Search people or posts"
          placeholder="Search"
          maxLength={200}
          value={query}
          onChange={(e) => {
            if (e.target.value.trim() !== term) invalidate();
            setQuery(e.target.value);
          }}
        />
        {query && (
          <button
            type="button"
            className="icon-button"
            aria-label="Clear search"
            onClick={() => {
              invalidate();
              setQuery("");
              input.current?.focus();
            }}
          >
            <X size={20} />
          </button>
        )}
      </form>
      <div className="timeline-tabs search-tabs" aria-label="Search results">
        {(["people", "posts"] as const).map((id) => (
          <button
            key={id}
            className={id === tab ? "selected" : ""}
            aria-pressed={id === tab}
            onClick={() => {
              if (id === tab) return;
              invalidate();
              setTab(id);
            }}
          >
            {id === "people" ? "People" : "Posts"}
          </button>
        ))}
      </div>
      {error && (
        <div className="error-box" role="alert">
          {error}
          <button onClick={() => void load()}>Retry</button>
        </div>
      )}
      {!term ? (
        <Empty icon={<Search />} title="Search Telos" description="" />
      ) : sessionLoading || (loading && !people.length && !posts.length) ? (
        <Loading />
      ) : !user ? (
        <Empty
          icon={<Search />}
          title="Sign in to search"
          description=""
          action={
            <Link className="primary-button" href="/login">
              Sign in
            </Link>
          }
        />
      ) : tab === "people" ? (
        <div className="people-list">
          {people.map((person) => (
            <article className="people-row" key={person.id}>
              <Avatar profile={person} onClick={() => onProfile(person)} />
              <button
                className="person-summary"
                onClick={() => onProfile(person)}
              >
                <strong>{person.name}</strong>
                <span>@{person.username}</span>
                {person.bio && <p>{person.bio}</p>}
              </button>
            </article>
          ))}
          {!people.length && !error && (
            <Empty icon={<Search />} title="No people found" description="" />
          )}
        </div>
      ) : (
        <div className="community-feed search-posts">
          {posts.map(renderPost)}
          {!posts.length && !error && (
            <Empty icon={<Search />} title="No posts found" description="" />
          )}
        </div>
      )}
      {more && (
        <button
          className="load-more"
          disabled={loading}
          onClick={() =>
            void load(tab === "people" ? people.length : posts.length)
          }
        >
          Show more
        </button>
      )}
    </section>
  );
}
