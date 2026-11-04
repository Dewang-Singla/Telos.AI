"use client";
import { useEffect, useRef, useId, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ArrowUpRight, X } from "lucide-react";
import { useTelos } from "./provider";
import type { Profile } from "@/lib/types";
let modalSequence = 0;
const modalStack: number[] = [];
let savedBodyOverflow = "";
export function Logo({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand ${small ? "brand-small" : ""}`}>
      <span className="brand-icon">
        <ArrowUpRight strokeWidth={2.6} />
      </span>
      telos<span className="brand-period">.</span>
    </span>
  );
}
export function Avatar({
  profile,
  size = "",
  onClick,
}: {
  profile?: Partial<Profile> | null;
  size?: string;
  onClick?: () => void;
}) {
  const { onlineIds } = useTelos();
  const content = profile?.avatar_url ? (
    <img
      src={profile.avatar_url}
      alt=""
      referrerPolicy="no-referrer"
      onError={(e) => {
        e.currentTarget.style.display = "none";
      }}
    />
  ) : null;
  const inner = (
    <>
      <span>
        {(profile?.name || "You")
          .split(" ")
          .map((s) => s[0])
          .slice(0, 2)
          .join("")}
      </span>
      {content}
      {profile?.id && !profile.is_demo && onlineIds.includes(profile.id) && (
        <i className="presence-dot" aria-label="Online" />
      )}
    </>
  );
  return onClick ? (
    <button
      className={`avatar ${size}`}
      onClick={onClick}
      aria-label={`View ${profile?.name || "your"} profile`}
    >
      {inner}
    </button>
  ) : (
    <span className={`avatar ${size}`}>{inner}</span>
  );
}
export function Modal({
  title,
  children,
  close,
  wide = false,
  busy = false,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
  wide?: boolean;
  busy?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null),
    closeRef = useRef(close);
  const titleId = useId();
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);
  useEffect(() => {
    closeRef.current = () => {
      if (!busy) close();
    };
  }, [close, busy]);
  useEffect(() => {
    if (!mounted) return;
    const modalId = ++modalSequence;
    const previous = document.activeElement as HTMLElement | null;
    if (!modalStack.length) savedBodyOverflow = document.body.style.overflow;
    modalStack.push(modalId);
    document.body.style.overflow = "hidden";
    const editor = ref.current?.querySelector<HTMLElement>(
      "textarea:not(:disabled),input:not(:disabled)",
    );
    (editor || ref.current)?.focus();
    const handler = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== modalId) return;
      if (e.key === "Escape") closeRef.current();
      if (e.key === "Tab") {
        const items = ref.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), a[href], input, textarea, select, [tabindex="0"]',
        );
        if (!items?.length) return;
        const first = items[0],
          last = items[items.length - 1];
        if (
          e.shiftKey &&
          (document.activeElement === first ||
            document.activeElement === ref.current)
        ) {
          e.preventDefault();
          last.focus();
        }
        if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      const wasTop = modalStack[modalStack.length - 1] === modalId;
      const index = modalStack.indexOf(modalId);
      if (index >= 0) modalStack.splice(index, 1);
      if (!modalStack.length) document.body.style.overflow = savedBodyOverflow;
      document.removeEventListener("keydown", handler);
      if (wasTop) previous?.focus();
    };
  }, [mounted]);
  if (!mounted) return null;
  return createPortal(
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) close();
      }}
    >
      <div
        className={`modal ${wide ? "wide" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={ref}
      >
        <header>
          <div>
            <h2 id={titleId}>{title}</h2>
          </div>
          <button
            className="icon-button"
            onClick={close}
            disabled={busy}
            aria-label="Close dialog"
          >
            <X size={21} />
          </button>
        </header>
        {children}
      </div>
    </div>,
    document.body,
  );
}
export function Empty({
  icon,
  title,
  description,
  action,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">{icon}</span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}
export function Loading() {
  return (
    <div
      className="loading-cards"
      aria-label="Loading intentions"
      aria-busy="true"
    >
      {[0, 1, 2].map((i) => (
        <div className="skeleton" key={i} />
      ))}
    </div>
  );
}
