"use client";
import { useEffect, useState, type FormEvent } from "react";
import { ChevronDown, Loader2, MapPin, SlidersHorizontal } from "lucide-react";
import { api } from "@/lib/api";
import { intentSchema } from "@/lib/validation";
import { roles, type Intent, type Role, type Mode } from "@/lib/types";
import { useTelos } from "./provider";
import { Avatar, Modal } from "./ui";
import { useDeviceLocation } from "./use-device-location";
const roleNames: Record<Role, string> = {
  open: "Any",
  socialize: "Connect",
  collaborate: "Collaborate",
  learn: "Learn",
  teach: "Teach",
  hire: "Hire",
  work: "Find work",
  request: "Request",
  offer: "Offer",
  organize: "Organize",
  join: "Join",
};
export function IntentComposer({
  close,
  onSave,
  existing,
  initialText = "",
}: {
  close: () => void;
  onSave: (id?: string) => void;
  existing?: Intent;
  initialText?: string;
}) {
  const { user, profile, toast } = useTelos();
  const {
    coordinates: coords,
    setCoordinates: setCoords,
    locating,
    error: locationError,
    requestLocation,
  } = useDeviceLocation();
  const [description, setDescription] = useState(
      existing?.description || initialText,
    ),
    [details, setDetails] = useState(false),
    [role, setRole] = useState<Role>(existing?.role || "open"),
    [mode, setMode] = useState<Mode>(existing?.mode || "online"),
    [city, setCity] = useState(existing?.city || ""),
    [tags, setTags] = useState(existing?.tags.join(", ") || ""),
    [skills, setSkills] = useState(existing?.skills.join(", ") || "");
  const [showOnProfile, setShowOnProfile] = useState(
    existing?.show_on_profile ?? false,
  );
  const [starts, setStarts] = useState(existing?.starts_at || ""),
    [ends, setEnds] = useState(existing?.ends_at || ""),
    [participants, setParticipants] = useState(existing?.participants || 2),
    [radius, setRadius] = useState(25),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [loaded, setLoaded] = useState(!existing);
  useEffect(() => {
    if (!existing) return;
    let cancelled = false;
    void api<{
      latitude: number | null;
      longitude: number | null;
      radius_km: number;
    }>(`intent-context?id=${existing.id}`)
      .then((c) => {
        if (cancelled) return;
        if (c.latitude !== null && c.longitude !== null)
          setCoords({ latitude: c.latitude, longitude: c.longitude });
        setRadius(c.radius_km);
        setLoaded(true);
      })
      .catch(() => setError("Couldn’t load this intent. Please reopen it."));
    return () => {
      cancelled = true;
    };
  }, [existing, setCoords]);
  const localDate = (value: string) =>
    value
      ? new Date(
          Date.parse(value) - new Date(value).getTimezoneOffset() * 60000,
        )
          .toISOString()
          .slice(0, 16)
      : "";
  async function locate() {
    if (await requestLocation()) {
      setCity("");
      setError("");
      if (mode === "online") setMode("hybrid");
    } else setDetails(true);
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!user) return;
    setBusy(true);
    setError("");
    try {
      const text = description.trim();
      const first = text.split(/[\n.!?]/)[0];
      const body = intentSchema.parse({
        title: (first.length >= 3 ? first : text).slice(0, 100),
        description: text,
        category: existing?.category || "Community",
        role,
        mode,
        city,
        tags: tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        skills: skills
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        starts_at: starts || null,
        ends_at: ends || null,
        participants,
        latitude: coords?.latitude ?? null,
        longitude: coords?.longitude ?? null,
        radius_km: radius,
        show_on_profile: showOnProfile,
      });
      const result = await api<{ id: string }>("intents", {
        ...body,
        id: existing?.id,
        automatic: !existing && !details,
      });
      onSave(result.id);
      close();
      toast(existing ? "Updated." : "Saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title={existing ? "Edit intent" : "New intent"}
      close={close}
      busy={busy}
      wide
    >
      <form className="new-intent-form" onSubmit={submit}>
        <div className="composer-author">
          <Avatar profile={profile} />
          <strong>{profile?.name || "You"}</strong>
        </div>
        <textarea
          className="intent-editor"
          aria-label="Your intent"
          autoFocus
          required
          minLength={3}
          maxLength={3000}
          rows={5}
          placeholder="What are you looking for?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
        <label className="visibility-choice">
          <input
            type="checkbox"
            checked={showOnProfile}
            onChange={(e) => setShowOnProfile(e.target.checked)}
          />
          Show on profile
        </label>
        <div className="composer-tools">
          <button
            type="button"
            className={`secondary-button ${coords ? "is-selected" : ""}`}
            onClick={locate}
            disabled={locating}
          >
            {locating ? (
              <Loader2 size={18} className="spin" />
            ) : (
              <MapPin size={18} />
            )}
            {coords ? "Current location" : "Use my location"}
          </button>
          {coords && (
            <button
              type="button"
              className="text-button"
              onClick={() => setCoords(null)}
            >
              Remove
            </button>
          )}
          <button
            type="button"
            className="text-button"
            onClick={() => setDetails((v) => !v)}
            aria-expanded={details}
          >
            <SlidersHorizontal size={18} />
            Details
            <ChevronDown size={17} />
          </button>
        </div>
        {locationError && (
          <p className="form-error" role="alert">
            {locationError}
          </p>
        )}
        {details && (
          <div className="intent-details">
            <div className="form-grid">
              <label>
                Intent
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as Role)}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {roleNames[r]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Mode
                <select
                  value={mode}
                  onChange={(e) => setMode(e.target.value as Mode)}
                >
                  <option value="online">Online</option>
                  <option value="in-person">In person</option>
                  <option value="hybrid">Either</option>
                </select>
              </label>
              <label>
                City
                <input
                  value={city}
                  maxLength={100}
                  onChange={(e) => {
                    setCity(e.target.value);
                    setCoords(null);
                  }}
                />
              </label>
              <label>
                Radius
                <select
                  value={coords ? radius : "city"}
                  disabled={!coords}
                  onChange={(e) => setRadius(Number(e.target.value))}
                >
                  {!coords && (
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
              </label>
              <label>
                From
                <input
                  type="datetime-local"
                  value={localDate(starts)}
                  onChange={(e) =>
                    setStarts(
                      e.target.value
                        ? new Date(e.target.value).toISOString()
                        : "",
                    )
                  }
                />
              </label>
              <label>
                Until
                <input
                  type="datetime-local"
                  value={localDate(ends)}
                  onChange={(e) =>
                    setEnds(
                      e.target.value
                        ? new Date(e.target.value).toISOString()
                        : "",
                    )
                  }
                />
              </label>
            </div>
            <label>
              Tags
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                maxLength={480}
              />
            </label>
            <label>
              Skills
              <input
                value={skills}
                onChange={(e) => setSkills(e.target.value)}
                maxLength={480}
              />
            </label>
            <label>
              People
              <input
                type="number"
                min={1}
                max={1000}
                value={participants}
                onChange={(e) => setParticipants(Number(e.target.value))}
              />
            </label>
          </div>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <footer className="modal-actions">
          <button
            className="primary-button"
            disabled={
              busy || locating || !loaded || description.trim().length < 3
            }
          >
            {busy ? (
              <>
                <Loader2 size={18} className="spin" />
                Saving…
              </>
            ) : existing ? (
              "Save"
            ) : (
              "Save intent"
            )}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
