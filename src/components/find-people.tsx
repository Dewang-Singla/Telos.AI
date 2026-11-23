"use client";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  Check,
  Loader2,
  MapPin,
  MoreHorizontal,
  Plus,
  RefreshCw,
  Search,
  Bookmark,
  SlidersHorizontal,
  Users,
  ArrowUpRight,
  Sparkles,
  ThumbsUp,
  X,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { intentDraft } from "@/lib/intent-input";
import { profileLocation } from "@/lib/profile-location";
import { connectionNote, searchExamples } from "@/lib/discovery";
import { browserClient } from "@/lib/supabase/client";
import type { Intent, PersonMatch, Profile, MatchPage } from "@/lib/types";
import { Avatar, Empty, Loading, Modal } from "./ui";
import { IntentComposer } from "./intent-composer";
import { useTelos } from "./provider";
import { useDeviceLocation } from "./use-device-location";

export function FindPeople({
  initialNearby = false,
  onProfile,
  onConnect,
  onReport,
  revision = 0,
  initialText = "",
}: {
  initialNearby?: boolean;
  onProfile: (p: Profile) => void;
  onConnect: (p: Profile, sourceId?: string, opener?: string) => void;
  onReport: (p: Profile) => void;
  revision?: number;
  initialText?: string;
}) {
  const { user, profile, toast } = useTelos();
  const {
    coordinates: place,
    setCoordinates: setPlace,
    locating,
    error: locationError,
    requestLocation,
    cancelLocation,
  } = useDeviceLocation();
  const [mine, setMine] = useState<Intent[]>([]),
    [selectedId, setSelectedId] = useState(""),
    [draft, setDraft] = useState(initialText),
    [matches, setMatches] = useState<PersonMatch[]>([]),
    [busy, setBusy] = useState(false),
    [creating, setCreating] = useState(false),
    [error, setError] = useState(""),
    [nearby, setNearby] = useState(initialNearby),
    [city, setCity] = useState(""),
    [radius, setRadius] = useState(25),
    [hasMore, setHasMore] = useState(false),
    [edit, setEdit] = useState<Intent | undefined>(),
    [composer, setComposer] = useState(false),
    [menu, setMenu] = useState("");
  const [historyMore, setHistoryMore] = useState(false),
    [historyBusy, setHistoryBusy] = useState(false);
  const [selected, setSelected] = useState<Intent | null>(null);
  const [savingIntent, setSavingIntent] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [savedFingerprint, setSavedFingerprint] = useState("");
  const fingerprint = JSON.stringify([
    draft.trim(),
    nearby,
    city,
    radius,
    place?.latitude ?? null,
    place?.longitude ?? null,
  ]);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const [matchingMode, setMatchingMode] = useState<"ai" | "keyword" | null>(
    null,
  );
  const [onlyReal, setOnlyReal] = useState(false);
  const [feedbackTarget, setFeedbackTarget] = useState<PersonMatch | null>(
    null,
  );
  const [feedbackReason, setFeedbackReason] = useState("different_goal");
  const [feedbackBusy, setFeedbackBusy] = useState("");
  const [hidden, setHidden] = useState<PersonMatch | null>(null);
  const feedbackLock = useRef(false);
  useEffect(() => {
    if (initialText) return;
    try {
      const saved = sessionStorage.getItem("telos.pending-intent");
      if (saved) {
        setDraft(saved.slice(0, 3000));
        sessionStorage.removeItem("telos.pending-intent");
      }
    } catch {
      /* Browser storage is optional. */
    }
  }, [initialText]);
  const searchAbort = useRef<AbortController | null>(null);
  const matchAbort = useRef<AbortController | null>(null);
  const refreshQueued = useRef(false);
  const latestFind = useRef<
    (offset?: number, quiet?: boolean) => Promise<void>
  >(async () => {});
  const [searched, setSearched] = useState<{
    id: string;
    saved: boolean;
  } | null>(null);
  const selectedRef = useRef<Intent | null>(null);
  const saving = useRef(false);
  const draftVersion = useRef(0);
  const [searchSession] = useState(() => crypto.randomUUID());
  const activate = useCallback((intent: Intent | null) => {
    selectedRef.current = intent;
    setSelected(intent);
    setSelectedId(intent?.id || "");
  }, []);
  const historyRequest = useRef(0);
  const cancelHistory = useCallback(() => {
    historyRequest.current++;
  }, []);
  const request = useRef(0),
    editor = useRef<HTMLTextAreaElement>(null);
  const contextRequest = useRef(0),
    resultsElement = useRef<HTMLElement>(null);
  const invalidate = useCallback(() => {
    request.current++;
    matchAbort.current?.abort();
    matchAbort.current = null;
  }, []);
  useEffect(
    () => () => {
      searchAbort.current?.abort();
      matchAbort.current?.abort();
    },
    [],
  );
  const loadMine = useCallback(
    async (offset = 0) => {
      if (!user) {
        setMine([]);
        return;
      }
      try {
        const version = ++historyRequest.current;
        const rows = await api<Intent[]>(`intents?offset=${offset}`);
        if (version !== historyRequest.current) return;
        const current = rows.find((row) => row.id === selectedRef.current?.id);
        if (current) {
          selectedRef.current = current;
          setSelected(current);
        }
        setMine((old) =>
          offset
            ? [
                ...old,
                ...rows.filter((row) => !old.some((i) => i.id === row.id)),
              ]
            : rows,
        );
        setHistoryMore(rows.length === 50);
        return rows;
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [user],
  );
  const find = useCallback(
    async (offset = 0, quiet = false) => {
      if (!user || !searched) return;
      if (feedbackLock.current) {
        refreshQueued.current = true;
        return;
      }
      if (nearby && !place && !city.trim()) {
        setMatches([]);
        setHasMore(false);
        setBusy(false);
        return;
      }
      if (quiet && matchAbort.current) {
        refreshQueued.current = true;
        return;
      }
      matchAbort.current?.abort();
      const controller = new AbortController();
      matchAbort.current = controller;
      const version = ++request.current;
      if (!quiet) {
        setBusy(true);
        setError("");
      }
      try {
        const page = await api<MatchPage>(
          "matching",
          {
            id: searched.id,
            nearby,
            latitude: place?.latitude ?? null,
            longitude: place?.longitude ?? null,
            city,
            radius,
            offset,
          },
          controller.signal,
        );
        if (version !== request.current || controller.signal.aborted) return;
        setMatches((old) =>
          offset
            ? [
                ...old,
                ...page.people.filter(
                  (p) => !old.some((o) => o.profile.id === p.profile.id),
                ),
              ]
            : page.people,
        );
        setNextOffset(page.next_offset);
        setHasMore(page.next_offset !== null);
        setMatchingMode(page.mode);
      } catch (e) {
        if (version === request.current && !controller.signal.aborted)
          setError((e as Error).message);
      } finally {
        if (matchAbort.current === controller) matchAbort.current = null;
        if (version === request.current) setBusy(false);
        if (
          version === request.current &&
          refreshQueued.current &&
          !controller.signal.aborted
        ) {
          refreshQueued.current = false;
          setTimeout(() => void latestFind.current(0, true), 200);
        }
      }
    },
    [user, searched, nearby, place, city, radius],
  );
  useEffect(() => {
    latestFind.current = find;
  }, [find]);
  useEffect(() => {
    void loadMine();
    return cancelHistory;
  }, [loadMine, revision, cancelHistory]);
  useEffect(() => {
    if (!searched) {
      setMatches([]);
      setBusy(false);
      setHasMore(false);
      return;
    }
    const timer = setTimeout(() => void find(), 180);
    return () => {
      clearTimeout(timer);
      invalidate();
    };
  }, [find, searched, revision, invalidate]);
  useEffect(() => {
    if (!user) return;
    const db = browserClient();
    let timer: ReturnType<typeof setTimeout>;
    const refresh = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        void find(0, true);
      }, 400);
    };
    const channel = db
      .channel(`private-search-${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "discovery_events" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "member_presence" },
        refresh,
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "member_presence" },
        refresh,
      )
      .subscribe((status) => {
        if (status === "SUBSCRIBED") refresh();
      });
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") refresh();
    }, 30000);
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      void db.removeChannel(channel);
    };
  }, [user, find, loadMine]);
  async function choose(intent: Intent) {
    if (saving.current && !searchAbort.current) return;
    clearResults();
    if (intent.status !== "active") {
      setEdit(intent);
      setComposer(true);
      return;
    }
    draftVersion.current++;
    setSearched(null);
    setRestoring(true);
    activate(intent);
    request.current++;
    setDraft(intent.description);
    setCity(intent.city);
    setPlace(null);
    const contextVersion = ++contextRequest.current;
    setMatches([]);
    setBusy(false);
    setError("");
    try {
      const context = await api<{
        latitude: number | null;
        longitude: number | null;
        radius_km: number;
      }>(`intent-context?id=${intent.id}`);
      if (contextVersion !== contextRequest.current) return;
      setRadius(context.radius_km);
      setPlace(
        context.latitude !== null && context.longitude !== null
          ? { latitude: context.latitude, longitude: context.longitude }
          : null,
      );
      const restoredNearby =
        intent.mode !== "online" &&
        Boolean(context.latitude !== null || intent.city.trim());
      setNearby(restoredNearby);
      setSearched({ id: intent.id, saved: true });
      setSavedFingerprint(
        JSON.stringify([
          intent.description.trim(),
          restoredNearby,
          intent.city,
          context.radius_km,
          context.latitude,
          context.longitude,
        ]),
      );
    } catch (e) {
      if (contextVersion === contextRequest.current)
        setError((e as Error).message);
    } finally {
      if (contextVersion === contextRequest.current) setRestoring(false);
    }
  }
  async function locate(onlyIfAllowed = false) {
    clearResults();
    if (await requestLocation(onlyIfAllowed)) {
      setCity("");
      setError("");
    }
  }
  function currentDraft() {
    const body = intentDraft(
      draft,
      nearby && place ? { ...place, city } : null,
    );
    if (nearby && city.trim() && !place) {
      body.city = city.trim();
      body.mode = "hybrid";
    }
    body.radius_km = radius;
    return body;
  }
  function clearResults() {
    setHidden(null);
    setFeedbackTarget(null);
    refreshQueued.current = false;
    const wasSearching = Boolean(searchAbort.current);
    searchAbort.current?.abort();
    searchAbort.current = null;
    matchAbort.current?.abort();
    matchAbort.current = null;
    if (wasSearching) {
      saving.current = false;
      setCreating(false);
    }
    setMatchingMode(null);
    setNextOffset(null);
    draftVersion.current++;
    contextRequest.current++;
    setRestoring(false);
    request.current++;
    setSearched(null);
    setMatches([]);
    setHasMore(false);
    setBusy(false);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) {
      try {
        sessionStorage.setItem("telos.pending-intent", draft);
      } catch {
        /* Search remains usable without browser storage. */
      }
      window.location.assign("/login");
      return;
    }
    if (!profile) {
      try {
        sessionStorage.setItem("telos.pending-intent", draft);
      } catch {
        /* Optional draft recovery. */
      }
      window.location.assign("/settings");
      return;
    }
    if (saving.current || restoring) return;
    if (nearby && !place && !city.trim()) {
      setError("Use your location or enter a city before searching nearby.");
      return;
    }
    const controller = new AbortController();
    searchAbort.current = controller;
    saving.current = true;
    setCreating(true);
    setError("");
    const version = ++draftVersion.current;
    contextRequest.current++;
    request.current++;
    setSearched(null);
    setMatches([]);
    setHasMore(false);
    setNextOffset(null);
    setMatchingMode(null);
    try {
      // Always interpret the current text; inferred roles from a saved search
      // must never carry into a different draft.
      const result = await api<{ id: string }>(
        "search",
        {
          ...currentDraft(),
          search_session: searchSession,
          search_version: version,
        },
        controller.signal,
      );
      if (version !== draftVersion.current) return;
      setSearched({ id: result.id, saved: false });
      if (window.matchMedia("(max-width:760px)").matches)
        resultsElement.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    } catch (e) {
      if (version === draftVersion.current && !controller.signal.aborted)
        setError((e as Error).message);
    } finally {
      if (searchAbort.current === controller) {
        searchAbort.current = null;
        saving.current = false;
        setCreating(false);
      }
    }
  }
  async function saveIntent() {
    if (!user) {
      window.location.assign("/login");
      return;
    }
    if (!profile) {
      window.location.assign("/settings");
      return;
    }
    if (saving.current || restoring || savedFingerprint === fingerprint) return;
    if (nearby && !place && !city.trim()) {
      setError("Use your location or enter a city before saving nearby.");
      return;
    }
    saving.current = true;
    setSavingIntent(true);
    setError("");
    const version = draftVersion.current;
    try {
      const body = currentDraft();
      const result = await api<{ id: string }>("intents", {
        ...body,
        automatic: true,
        id: searched?.id,
      });
      const rows = await loadMine();
      if (version === draftVersion.current) {
        const saved = rows?.find((row) => row.id === result.id);
        if (saved) activate(saved);
        setSavedFingerprint(fingerprint);
      }
      toast("Intent saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      saving.current = false;
      setSavingIntent(false);
    }
  }
  async function status(
    intent: Intent,
    value: "active" | "paused" | "completed" | "delete",
  ) {
    if (value === "delete" && !window.confirm("Delete this intent?")) return;
    try {
      await api("status", { id: intent.id, status: value });
      if (intent.id === selectedId && value !== "active") {
        contextRequest.current++;
        activate(null);
        clearResults();
      }
      await loadMine();
      setMenu("");
    } catch (e) {
      toast((e as Error).message);
    }
  }
  function newSearch() {
    if (saving.current && !searchAbort.current) return;
    clearResults();
    activate(null);
    setDraft("");
    setMatches([]);
    setError("");
    setBusy(false);
    setHasMore(false);
    setPlace(null);
    setCity("");
    contextRequest.current++;
    editor.current?.focus();
  }
  async function feedback(
    person: PersonMatch,
    verdict: "helpful" | "not_relevant" | "clear",
    reason = "",
  ) {
    if (!searched || !person.matched_intent || feedbackLock.current) return;
    const sourceId = searched.id,
      version = draftVersion.current;
    feedbackLock.current = true;
    invalidate();
    refreshQueued.current = false;
    setBusy(false);
    setFeedbackBusy(person.profile.id);
    try {
      await api("match-feedback", {
        source_id: sourceId,
        candidate_id: person.profile.id,
        candidate_text: person.matched_intent,
        verdict,
        reason,
      });
      if (version !== draftVersion.current) return;
      if (verdict === "not_relevant") {
        setMatches((rows) =>
          rows.filter((row) => row.profile.id !== person.profile.id),
        );
        setHidden(person);
        setFeedbackTarget(null);
      } else if (
        verdict === "clear" &&
        hidden?.profile.id === person.profile.id
      ) {
        setHidden(null);
        void find();
      } else
        setMatches((rows) =>
          rows.map((row) =>
            row.profile.id === person.profile.id
              ? { ...row, feedback: verdict === "helpful" ? "helpful" : null }
              : row,
          ),
        );
    } catch {
      toast("Could not save your feedback. Please try again.");
    } finally {
      feedbackLock.current = false;
      setFeedbackBusy("");
      if (version === draftVersion.current && refreshQueued.current) {
        refreshQueued.current = false;
        void latestFind.current(0, true);
      }
    }
  }
  const displayedMatches = onlyReal
    ? matches.filter((person) => !person.profile.is_demo)
    : matches;
  const history = (
    <div className="private-intents">
      {mine.map((intent) => (
        <article
          className={
            selectedId === intent.id &&
            selected?.description.trim() === draft.trim()
              ? "selected"
              : ""
          }
          key={intent.id}
        >
          <button
            type="button"
            className="private-intent-title"
            onClick={() => void choose(intent)}
          >
            <strong>{intent.title}</strong>
            <span>
              {intent.show_on_profile ? "On profile" : "Matches"}
              {intent.status !== "active" && ` · ${intent.status}`}
            </span>
          </button>
          <div className="post-menu">
            <button
              className="icon-button"
              aria-label="Intent options"
              onClick={() => setMenu((m) => (m === intent.id ? "" : intent.id))}
            >
              <MoreHorizontal size={20} />
            </button>
            {menu === intent.id && (
              <>
                <button
                  className="menu-dismiss"
                  aria-label="Close options"
                  onClick={() => setMenu("")}
                />
                <div className="dropdown-menu">
                  <button
                    onClick={() => {
                      setEdit(intent);
                      setComposer(true);
                      setMenu("");
                    }}
                  >
                    Edit
                  </button>
                  <button
                    onClick={async () => {
                      try {
                        await api("intent-visibility", {
                          id: intent.id,
                          show_on_profile: !intent.show_on_profile,
                        });
                        await loadMine();
                        setMenu("");
                      } catch (e) {
                        toast((e as Error).message);
                      }
                    }}
                  >
                    {intent.show_on_profile
                      ? "Hide from profile"
                      : "Show on profile"}
                  </button>
                  <button
                    onClick={() =>
                      void status(
                        intent,
                        intent.status === "active" ? "paused" : "active",
                      )
                    }
                  >
                    {intent.status === "active" ? "Pause" : "Reopen"}
                  </button>
                  <button onClick={() => void status(intent, "completed")}>
                    Complete
                  </button>
                  <button
                    className="danger-link"
                    onClick={() => void status(intent, "delete")}
                  >
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        </article>
      ))}
      {!mine.length && (
        <div className="no-history">
          <Search size={21} />
          <span>No saved intents</span>
        </div>
      )}
    </div>
  );
  return (
    <div className="discovery-page">
      <div className="discovery-intro">
        <div>
          <span className="eyebrow">MAKE YOUR NEXT CONNECTION COUNT</span>
          <h1>What do you have in mind?</h1>
          <p>
            Find people around a shared goal, a useful skill, or something you
            want to try.
          </p>
        </div>
        <Link href="/progress" className="text-button">
          My progress <ArrowUpRight size={17} />
        </Link>
      </div>
      {user && !profile && (
        <div className="discovery-onboarding">
          <ShieldCheck size={23} />
          <div>
            <strong>Start with a simple introduction.</strong>
            <p>
              Create a name and username so people know who is reaching out.
              Other profile details are optional.
            </p>
          </div>
          <Link href="/settings" className="secondary-button">
            Create profile <ArrowUpRight size={16} />
          </Link>
        </div>
      )}
      <div className="find-workspace">
        <section className="search-workbench">
          <div className="search-workbench-heading">
            <h2>{selected ? "Your intention" : "Start with an intention"}</h2>
            <button
              className="icon-button"
              aria-label="New search"
              onClick={newSearch}
            >
              <Plus size={23} />
            </button>
          </div>
          <form onSubmit={submit}>
            <p className="search-helper">
              What would you like to do, and who could help make it happen?
            </p>
            <textarea
              ref={editor}
              aria-label="Your intent"
              placeholder="e.g. I'd like to learn guitar from someone who enjoys teaching beginners…"
              rows={5}
              maxLength={3000}
              required
              minLength={3}
              value={draft}
              onChange={(e) => {
                contextRequest.current++;
                clearResults();
                setDraft(e.target.value);
              }}
            />
            {!draft.trim() && (
              <div className="prompt-suggestions" aria-label="Try an intention">
                {searchExamples.map((example) => (
                  <button
                    type="button"
                    key={example.label}
                    onClick={() => {
                      clearResults();
                      activate(null);
                      setDraft(example.text);
                      editor.current?.focus();
                    }}
                  >
                    {example.label}
                    <ArrowUpRight size={13} />
                  </button>
                ))}
              </div>
            )}
            <div className="search-settings">
              <button
                type="button"
                className={`nearby-toggle ${nearby ? "enabled" : ""}`}
                role="switch"
                aria-checked={nearby}
                onClick={() => {
                  clearResults();
                  const enabled = !nearby;
                  setNearby(enabled);
                  setError("");
                  if (!enabled) cancelLocation();
                  else if (!place && !city.trim()) void locate(true);
                }}
              >
                <MapPin size={18} />
                Nearby
                <span className="switch-track">
                  <i />
                </span>
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label="More details"
                onClick={() => {
                  if (!user) {
                    window.location.assign("/login");
                    return;
                  }
                  setEdit(undefined);
                  setComposer(true);
                }}
              >
                <SlidersHorizontal size={20} />
              </button>
            </div>
            {nearby && (
              <div className="private-location-controls">
                <input
                  aria-label="City"
                  maxLength={100}
                  placeholder="City"
                  value={city}
                  onChange={(e) => {
                    clearResults();
                    setCity(e.target.value);
                    setPlace(null);
                    setError("");
                  }}
                />
                <select
                  aria-label="Radius"
                  value={place ? radius : "city"}
                  disabled={!place}
                  onChange={(e) => {
                    clearResults();
                    setRadius(Number(e.target.value));
                  }}
                >
                  {!place && (
                    <option value="city">
                      {city.trim() ? "City only" : "Radius"}
                    </option>
                  )}
                  {[5, 10, 25, 50, 100].map((km) => (
                    <option key={km} value={km}>
                      {km} km
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className={`secondary-button ${place ? "is-selected" : ""}`}
                  disabled={locating}
                  onClick={() => void locate()}
                >
                  {locating ? (
                    <Loader2 className="spin" size={18} />
                  ) : place ? (
                    <Check size={18} />
                  ) : (
                    <MapPin size={18} />
                  )}
                  {place ? "Current location" : "Use my location"}
                </button>
                {locationError && (
                  <p className="location-error" role="alert">
                    {locationError}
                  </p>
                )}
              </div>
            )}
            <button
              className="primary-button full search-submit"
              disabled={
                creating ||
                restoring ||
                locating ||
                savingIntent ||
                draft.trim().length < 3
              }
            >
              {creating ? (
                <Loader2 className="spin" size={21} />
              ) : (
                <Search size={21} />
              )}
              {creating ? "Understanding your intention…" : "Find people"}
            </button>
            <p className="search-lifecycle">
              <ShieldCheck size={13} /> Your latest search is discoverable for
              up to 24 hours. A new search replaces it. Save one to keep it
              active.
            </p>
            <details className="intent-privacy">
              <summary>Who can see my intention?</summary>
              <p>
                People with a compatible search can see your intention for
                context. Your saved list is private; displaying an intention on
                your profile is optional. Search text may be processed by the AI
                provider to help find relevant connections.
              </p>
            </details>
            <button
              type="button"
              className="secondary-button full save-intent-button"
              disabled={
                creating ||
                savingIntent ||
                restoring ||
                locating ||
                draft.trim().length < 3 ||
                savedFingerprint === fingerprint
              }
              onClick={() => void saveIntent()}
            >
              {savingIntent ? (
                <Loader2 className="spin" size={19} />
              ) : (
                <Bookmark size={19} />
              )}
              {savedFingerprint === fingerprint ? "Saved" : "Save intent"}
            </button>
          </form>
          <div className="search-history-heading">
            <h3>Your saved intentions</h3>
          </div>
          {history}
          {historyMore && (
            <button
              className="load-more"
              disabled={historyBusy}
              onClick={async () => {
                setHistoryBusy(true);
                await loadMine(mine.length);
                setHistoryBusy(false);
              }}
            >
              Show more
            </button>
          )}
        </section>
        <section className="people-results" ref={resultsElement}>
          <header>
            <div>
              <h2>
                {searched
                  ? "Your connections start here"
                  : "Discover your next possibility"}
              </h2>
              {searched && (
                <p className="result-count">
                  {displayedMatches.length}
                  {hasMore ? "+" : ""} matches in this result set
                </p>
              )}
            </div>
            {matchingMode && (
              <span className="matching-mode" role="status">
                {matchingMode === "ai" ? "AI matching" : "Keyword matching"}
              </span>
            )}
            {searched && (
              <button
                className="icon-button"
                aria-label="Refresh matches"
                disabled={busy}
                onClick={() => void find()}
              >
                <RefreshCw className={busy ? "spin" : ""} size={21} />
              </button>
            )}
          </header>
          {searched && (
            <div className="discovery-result-toolbar">
              <span>
                <Sparkles size={14} /> Goal and topic fit come before online
                status.
              </span>
              <label>
                <input
                  type="checkbox"
                  checked={onlyReal}
                  onChange={(e) => setOnlyReal(e.target.checked)}
                />{" "}
                Hide demo profiles
              </label>
            </div>
          )}
          {hidden && (
            <div className="feedback-confirmation" role="status">
              Match hidden for this intention.
              <button
                disabled={Boolean(feedbackBusy)}
                onClick={() => void feedback(hidden, "clear")}
              >
                Undo
              </button>
            </div>
          )}
          {error && (
            <div className="error-box" role="alert">
              {error}
            </div>
          )}
          {creating || (busy && !matches.length) ? (
            <div className="discovery-loading" role="status">
              <span className="discovery-orbit">
                <Sparkles size={26} />
              </span>
              <h3>
                {creating
                  ? "Making sense of your intention"
                  : "Looking for common ground"}
              </h3>
              <p>
                {creating
                  ? "Understanding what you want to do and the kind of connection that could help."
                  : "Checking related goals, requests and offers. You stay in control of the next step."}
              </p>
              <Loading />
            </div>
          ) : (
            displayedMatches.map((person) => (
              <article className="match-person" key={person.profile.id}>
                <div className="match-person-top">
                  <Avatar
                    profile={person.profile}
                    size="large"
                    onClick={() => onProfile(person.profile)}
                  />
                  <button
                    className="icon-button"
                    aria-label="Profile options"
                    onClick={() => onReport(person.profile)}
                  >
                    <MoreHorizontal size={22} />
                  </button>
                </div>
                <button
                  className="match-person-name"
                  onClick={() => onProfile(person.profile)}
                >
                  <h3>{person.profile.name}</h3>
                  {person.profile.is_demo && (
                    <span className="demo-badge">Demo bot</span>
                  )}
                  <span>@{person.profile.username}</span>
                </button>
                {person.profile.bio && <p>{person.profile.bio}</p>}
                {person.explanation && (
                  <div
                    className={`match-explanation ${person.explanation.kind}`}
                  >
                    <span>
                      <Sparkles size={14} />
                      {person.explanation.label}
                    </span>
                    <p>{person.explanation.detail}</p>
                  </div>
                )}
                {person.matched_intent && (
                  <blockquote className="matched-intent">
                    {person.matched_intent}
                  </blockquote>
                )}
                <div className="match-person-meta">
                  <span
                    className={person.is_online ? "is-online" : "is-offline"}
                  >
                    {person.is_online ? "Online" : "Offline"}
                  </span>
                  {person.distance_km !== null ? (
                    <span>
                      <MapPin size={17} />
                      {Math.max(1, Math.round(person.distance_km))} km
                    </span>
                  ) : profileLocation(person.profile) ? (
                    <span>
                      <MapPin size={17} />
                      {profileLocation(person.profile)}
                    </span>
                  ) : null}
                </div>
                {person.profile.interests.length > 0 && (
                  <div className="profile-tags">
                    {person.profile.interests.slice(0, 4).map((interest) => (
                      <span key={interest}>{interest}</span>
                    ))}
                  </div>
                )}
                <button
                  className="primary-button"
                  onClick={() =>
                    person.profile.is_demo
                      ? onProfile(person.profile)
                      : onConnect(
                          person.profile,
                          searched?.id,
                          connectionNote(
                            draft,
                            person.matched_intent || "",
                            person.profile.name,
                          ),
                        )
                  }
                >
                  {person.profile.is_demo
                    ? "Explore demo profile"
                    : "Start a conversation"}
                  <ArrowUpRight size={17} />
                </button>
                {person.profile.is_demo && (
                  <p className="demo-explanation">
                    Fictional demo profile. It can’t accept invitations or
                    reply.
                  </p>
                )}
                {person.matched_intent && (
                  <div
                    className="match-feedback"
                    aria-label={`Feedback on ${person.profile.name}'s match`}
                  >
                    <button
                      aria-pressed={person.feedback === "helpful"}
                      disabled={Boolean(feedbackBusy)}
                      onClick={() =>
                        void feedback(
                          person,
                          person.feedback === "helpful" ? "clear" : "helpful",
                        )
                      }
                    >
                      <ThumbsUp size={14} />
                      {person.feedback === "helpful"
                        ? "Marked helpful"
                        : "Helpful"}
                    </button>
                    <button
                      disabled={Boolean(feedbackBusy)}
                      onClick={() => {
                        setFeedbackTarget(person);
                        setFeedbackReason("different_goal");
                      }}
                    >
                      <X size={14} />
                      Not a fit
                    </button>
                  </div>
                )}
              </article>
            ))
          )}
          {!creating && !busy && !displayedMatches.length && !error && (
            <Empty
              icon={searched ? <Users /> : <Search />}
              title={
                nearby && !place && !city.trim()
                  ? "Choose a location"
                  : searched
                    ? "No matches yet"
                    : "Start a search"
              }
              description={
                searched
                  ? onlyReal && matches.length
                    ? "There are demo results in this set. Turn off Hide demo profiles to explore them, or keep your intention active for real people to find you."
                    : "A useful connection can take time. Try a clearer subject, keep your intention active, or explore a wider area. Saved intentions stay discoverable until you pause them."
                  : "Tell us what you're hoping to learn, create, offer or join. You'll be able to review each person's intention before reaching out."
              }
              action={
                !searched ? (
                  <div className="empty-intention-prompts">
                    {searchExamples.slice(0, 3).map((example) => (
                      <button
                        className="secondary-button"
                        key={example.label}
                        onClick={() => {
                          setDraft(example.text);
                          editor.current?.focus();
                        }}
                      >
                        {example.label}
                        <ArrowUpRight size={15} />
                      </button>
                    ))}
                  </div>
                ) : undefined
              }
            />
          )}
          {hasMore && (
            <button
              className="load-more"
              disabled={busy}
              onClick={() => nextOffset !== null && void find(nextOffset)}
            >
              Show more
            </button>
          )}
        </section>
        {feedbackTarget && (
          <Modal
            title="What didn't fit?"
            close={() => setFeedbackTarget(null)}
            busy={Boolean(feedbackBusy)}
          >
            <p className="feedback-modal-copy">
              Your feedback is private. Hide this intention from your current
              search without blocking the person.
            </p>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void feedback(feedbackTarget, "not_relevant", feedbackReason);
              }}
            >
              <fieldset className="feedback-reasons">
                <legend className="sr-only">Reason</legend>
                {[
                  ["different_goal", "The topic or goal is different"],
                  ["wrong_role", "The request or offer doesn't fit"],
                  ["location", "The location doesn't work for me"],
                  ["other", "Something else"],
                ].map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="radio"
                      name="feedback-reason"
                      value={value}
                      checked={feedbackReason === value}
                      onChange={() => setFeedbackReason(value)}
                    />
                    {label}
                  </label>
                ))}
              </fieldset>
              <div className="modal-actions">
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setFeedbackTarget(null)}
                  disabled={Boolean(feedbackBusy)}
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={Boolean(feedbackBusy)}
                >
                  Hide match
                </button>
              </div>
            </form>
          </Modal>
        )}
        {composer && (
          <IntentComposer
            existing={edit}
            initialText={draft}
            close={() => {
              setComposer(false);
              setEdit(undefined);
            }}
            onSave={(id) => {
              void loadMine().then((rows) => {
                const saved = rows?.find((i) => i.id === id);
                if (saved?.status === "active") void choose(saved);
                else newSearch();
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
