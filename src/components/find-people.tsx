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
} from "lucide-react";
import { api } from "@/lib/api";
import { intentDraft } from "@/lib/intent-input";
import { profileLocation } from "@/lib/profile-location";
import { browserClient } from "@/lib/supabase/client";
import type { Intent, PersonMatch, Profile } from "@/lib/types";
import { Avatar, Empty, Loading } from "./ui";
import { IntentComposer } from "./intent-composer";
import { useTelos } from "./provider";
import { useDeviceLocation } from "./use-device-location";

export function FindPeople({
  initialNearby = false,
  onProfile,
  onConnect,
  onReport,
  revision = 0,
}: {
  initialNearby?: boolean;
  onProfile: (p: Profile) => void;
  onConnect: (p: Profile, sourceId?: string) => void;
  onReport: (p: Profile) => void;
  revision?: number;
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
    [draft, setDraft] = useState(""),
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
  const [searched, setSearched] = useState<{
    id: string;
    saved: boolean;
  } | null>(null);
  const selectedRef = useRef<Intent | null>(null);
  const saving = useRef(false);
  const draftVersion = useRef(0);
  const activate = useCallback((intent: Intent | null) => {
    selectedRef.current = intent;
    setSelected(intent);
    setSelectedId(intent?.id || "");
  }, []);
  const request = useRef(0),
    editor = useRef<HTMLTextAreaElement>(null);
  const contextRequest = useRef(0),
    resultsElement = useRef<HTMLElement>(null);
  const invalidate = useCallback(() => {
    request.current++;
  }, []);
  const loadMine = useCallback(
    async (offset = 0) => {
      if (!user) {
        setMine([]);
        return;
      }
      try {
        const rows = await api<Intent[]>(`intents?offset=${offset}`);
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
      if (nearby && !place && !city.trim()) {
        setMatches([]);
        setHasMore(false);
        setBusy(false);
        return;
      }
      const version = ++request.current;
      if (!quiet) setBusy(true);
      setError("");
      try {
        const people = await api<PersonMatch[]>(
          searched.saved ? "matches" : "search-matches",
          {
            id: searched.id,
            nearby,
            latitude: place?.latitude ?? null,
            longitude: place?.longitude ?? null,
            city,
            radius,
            offset,
          },
        );
        if (version !== request.current) return;
        setMatches((old) =>
          offset
            ? [
                ...old,
                ...people.filter(
                  (p) => !old.some((o) => o.profile.id === p.profile.id),
                ),
              ]
            : people,
        );
        setHasMore(people.length === 30);
      } catch (e) {
        if (version === request.current) {
          setError((e as Error).message);
          setMatches([]);
        }
      } finally {
        if (version === request.current) setBusy(false);
      }
    },
    [user, searched, nearby, place, city, radius],
  );
  useEffect(() => {
    void loadMine();
  }, [loadMine, revision]);
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
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      window.removeEventListener("focus", refresh);
      void db.removeChannel(channel);
    };
  }, [user, find, loadMine]);
  async function choose(intent: Intent) {
    if (saving.current) return;
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
      setSearched({ id: intent.id, saved: true });
      setSavedFingerprint(
        JSON.stringify([
          intent.description.trim(),
          nearby,
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
      window.location.assign("/login");
      return;
    }
    if (!profile) {
      window.location.assign("/settings");
      return;
    }
    if (saving.current || restoring) return;
    if (nearby && !place && !city.trim()) {
      setError("Use your location or enter a city before searching nearby.");
      return;
    }
    saving.current = true;
    setCreating(true);
    setError("");
    const version = ++draftVersion.current;
    contextRequest.current++;
    request.current++;
    setSearched(null);
    setMatches([]);
    try {
      // Always interpret the current text; inferred roles from a saved search
      // must never carry into a different draft.
      const result = await api<{ id: string }>("search", currentDraft());
      if (version !== draftVersion.current) return;
      setSearched({ id: result.id, saved: false });
      if (window.matchMedia("(max-width:760px)").matches)
        resultsElement.current?.scrollIntoView({
          behavior: "smooth",
          block: "start",
        });
    } catch (e) {
      if (version === draftVersion.current) setError((e as Error).message);
    } finally {
      saving.current = false;
      setCreating(false);
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
    if (saving.current) return;
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
    <div className="find-workspace">
      <section className="search-workbench">
        <div className="search-workbench-heading">
          <h2>{selected ? "Your search" : "New search"}</h2>
          <button
            className="icon-button"
            aria-label="New search"
            onClick={newSearch}
          >
            <Plus size={23} />
          </button>
        </div>
        <form onSubmit={submit}>
          <textarea
            ref={editor}
            aria-label="Your intent"
            placeholder="What are you looking for?"
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
              creating || restoring || locating || savingIntent || draft.trim().length < 3
            }
          >
            {creating ? (
              <Loader2 className="spin" size={21} />
            ) : (
              <Search size={21} />
            )}
            Find people
          </button>
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
          <h3>Your intents</h3>
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
          <h2>People</h2>
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
        {error && (
          <div className="error-box" role="alert">
            {error}
          </div>
        )}
        {creating || (busy && !matches.length) ? (
          <Loading />
        ) : (
          matches.map((person) => (
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
              {person.matched_intent && (
                <blockquote className="matched-intent">
                  {person.matched_intent}
                </blockquote>
              )}
              <div className="match-person-meta">
                <span className={person.is_online ? "is-online" : "is-offline"}>
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
                  onConnect(
                    person.profile,
                    searched?.saved ? searched.id : undefined,
                  )
                }
              >
                Connect
              </button>
            </article>
          ))
        )}
        {!creating && !busy && !matches.length && !error && (
          <Empty
            icon={searched ? <Users /> : <Search />}
            title={
              nearby && !place && !city.trim()
                ? "Choose a location"
                : searched
                  ? "No matches yet"
                  : "Start a search"
            }
            description=""
          />
        )}
        {hasMore && (
          <button
            className="load-more"
            disabled={busy}
            onClick={() => void find(matches.length)}
          >
            Show more
          </button>
        )}
      </section>
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
  );
}
