"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Check,
  Circle,
  Flag,
  Handshake,
  Heart,
  MessageCircle,
  RefreshCw,
  Search,
  Target,
} from "lucide-react";
import { api } from "@/lib/api";
import { profileReadiness } from "@/lib/discovery";
import type { ProgressSummary } from "@/lib/types";
import { useTelos } from "./provider";
import { Empty, Loading } from "./ui";

export function Progress() {
  const { user, profile, relationshipRevision, toast } = useTelos();
  const [summary, setSummary] = useState<ProgressSummary | null>(null);
  const [error, setError] = useState(false),
    [loading, setLoading] = useState(true),
    [revision, setRevision] = useState(0),
    [saving, setSaving] = useState("");
  const submitting = useRef(false);
  useEffect(() => {
    if (!user) {
      setSummary(null);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(false);
    void api<ProgressSummary>("progress", undefined, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setSummary(result);
      })
      .catch(() => {
        if (!controller.signal.aborted) setError(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => {
      controller.abort();
    };
  }, [user, revision, relationshipRevision]);
  async function outcome(
    id: string,
    value: "useful" | "not_yet" | "not_a_fit",
  ) {
    if (submitting.current) return;
    submitting.current = true;
    setSaving(id);
    try {
      await api("connection-outcome", { request_id: id, outcome: value });
      setRevision((r) => r + 1);
      toast("Your private feedback has been saved.");
    } catch {
      toast("Could not save feedback. Please try again.");
    } finally {
      submitting.current = false;
      setSaving("");
    }
  }
  if (!user)
    return (
      <Empty
        icon={<Target />}
        title="Your connections, with purpose"
        description="Sign in to keep track of intentions, conversations and what worked out."
        action={
          <Link href="/login" className="primary-button">
            Sign in
          </Link>
        }
      />
    );
  const checklist = profile ? profileReadiness(profile) : [];
  return (
    <div className="progress-page">
      <section className="progress-intro">
        <div>
          <span className="eyebrow">YOUR NEXT CHAPTER</span>
          <h1>
            Small steps.
            <br />
            <em>Meaningful connections.</em>
          </h1>
          <p>
            See what you’ve started and keep track of the connections that made
            a difference.
          </p>
        </div>
        <Link href="/find" className="primary-button">
          Find your next connection <ArrowUpRight size={18} />
        </Link>
      </section>
      {loading && !summary ? (
        <Loading />
      ) : error ? (
        <div className="progress-unavailable" role="alert">
          <h2>Your progress is temporarily unavailable</h2>
          <p>You can still find people and continue your conversations.</p>
          <button
            className="secondary-button"
            onClick={() => setRevision((r) => r + 1)}
          >
            <RefreshCw size={17} /> Try again
          </button>
        </div>
      ) : (
        summary && (
          <>
            <div className="progress-stats">
              {[
                {
                  icon: <Flag />,
                  value: summary.active_intents,
                  label: "Active intentions",
                  detail: `${summary.saved_intents} saved for later`,
                  href: "/find",
                },
                {
                  icon: <Handshake />,
                  value: summary.accepted_requests,
                  label: "Current connections",
                  detail: "Accepted invitations with real members",
                  href: "/connections",
                },
                {
                  icon: <MessageCircle />,
                  value: summary.conversations,
                  label: "Conversations joined",
                  detail: "Chats where you've sent a message",
                  href: "/messages",
                },
              ].map((stat) => (
                <Link
                  className="progress-stat"
                  href={stat.href}
                  key={stat.label}
                >
                  <span>
                    {stat.icon}
                    <ArrowUpRight size={16} />
                  </span>
                  <strong>{stat.value}</strong>
                  <h2>{stat.label}</h2>
                  <p>{stat.detail}</p>
                </Link>
              ))}
            </div>
            <div className="progress-columns">
              <section className="progress-connections">
                <header>
                  <div>
                    <span className="eyebrow">BEYOND THE INTRODUCTION</span>
                    <h2>Did something good come from it?</h2>
                  </div>
                  <span className="outcome-total">
                    <Heart size={16} />
                    {summary.useful_connections} useful
                  </span>
                </header>
                <p>
                  Your answer is private. It helps you reflect and helps us
                  understand whether Telos creates useful connections.
                </p>
                {!summary.connections.length ? (
                  <div className="progress-first-step">
                    <Handshake size={29} />
                    <h3>Your first connection starts with an intention</h3>
                    <p>
                      Find someone with a related goal, send an invitation, and
                      start a conversation when they accept.
                    </p>
                    <Link href="/find" className="text-button">
                      Explore intentions <ArrowUpRight size={17} />
                    </Link>
                  </div>
                ) : (
                  <div className="outcome-list">
                    {summary.connections.map((connection) => (
                      <article key={connection.id}>
                        <div>
                          <span className="outcome-avatar">
                            {connection.name.slice(0, 1).toUpperCase()}
                          </span>
                          <div>
                            <h3>{connection.name}</h3>
                            <span>@{connection.username}</span>
                          </div>
                          {connection.conversation_id && (
                            <Link
                              href={`/messages?conversation=${connection.conversation_id}`}
                              aria-label={`Message ${connection.name}`}
                              className="icon-button"
                            >
                              <MessageCircle size={19} />
                            </Link>
                          )}
                        </div>
                        <div
                          className="outcome-options"
                          role="group"
                          aria-label={`Outcome of your connection with ${connection.name}`}
                        >
                          {(
                            [
                              ["useful", "Useful connection"],
                              ["not_yet", "Still exploring"],
                              ["not_a_fit", "Not a fit"],
                            ] as const
                          ).map(([value, label]) => (
                            <button
                              key={value}
                              aria-pressed={connection.outcome === value}
                              disabled={Boolean(saving)}
                              onClick={() => void outcome(connection.id, value)}
                            >
                              {connection.outcome === value && (
                                <Check size={13} />
                              )}
                              {saving === connection.id ? "Saving…" : label}
                            </button>
                          ))}
                        </div>
                      </article>
                    ))}
                  </div>
                )}
              </section>
              <aside className="activation-card">
                <span className="eyebrow">LET PEOPLE GET TO KNOW YOU</span>
                <h2>Give a connection a head start.</h2>
                <p>
                  A little context makes it easier for someone to say hello.
                </p>
                <ul>
                  {checklist.length ? (
                    checklist.map((item) => (
                      <li key={item.label}>
                        {item.done ? <Check size={18} /> : <Circle size={18} />}
                        <div>
                          <strong>{item.label}</strong>
                          <span>{item.hint}</span>
                        </div>
                      </li>
                    ))
                  ) : (
                    <li>
                      <Circle size={18} />
                      <div>
                        <strong>Create your profile</strong>
                        <span>
                          Just a name and username to get started. Other details
                          are optional.
                        </span>
                      </div>
                    </li>
                  )}
                </ul>
                <Link href="/settings" className="secondary-button full">
                  {profile ? "Update your profile" : "Create profile"}{" "}
                  <ArrowUpRight size={17} />
                </Link>
                <div className="progress-footnote">
                  <Search size={17} />
                  <span>
                    {summary.helpful_matches} matches marked helpful. Demo
                    profiles are excluded from connection and feedback totals.
                  </span>
                </div>
              </aside>
            </div>
          </>
        )
      )}
    </div>
  );
}
