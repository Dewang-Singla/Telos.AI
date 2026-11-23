"use client";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowRight,
  ArrowUpRight,
  Check,
  Compass,
  Fingerprint,
  Handshake,
  Lightbulb,
  MessageCircle,
  MoveUpRight,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { Logo } from "./ui";
import { useTelos } from "./provider";

const scenarios = [
  {
    label: "Learn something",
    request: "I want to learn guitar. Anyone happy to teach a beginner?",
    offer:
      "I teach acoustic guitar and enjoy helping beginners find their rhythm.",
    role: "Potential mentor",
    topic: "Music & learning",
    initials: "GT",
    color: "apricot",
  },
  {
    label: "Build together",
    request: "Looking for a designer to build a small app with me.",
    offer:
      "I'm a product designer looking for a developer to collaborate on a side project.",
    role: "Potential collaborator",
    topic: "Design & technology",
    initials: "PD",
    color: "lavender",
  },
  {
    label: "Make a difference",
    request: "We need volunteers for a community environmental project.",
    offer:
      "I'd like to volunteer and help with a local environmental initiative.",
    role: "Potential participant",
    topic: "Community & volunteering",
    initials: "CV",
    color: "sage",
  },
];

export function Welcome() {
  const { user } = useTelos();
  const [example, setExample] = useState(0);
  const current = scenarios[example];
  const destination = `/find?intent=${encodeURIComponent(current.request)}`;
  return (
    <div className="landing">
      <a className="skip-link" href="#landing-main">
        Skip to content
      </a>
      <header className="landing-nav">
        <Link href="/" aria-label="Telos home">
          <Logo />
        </Link>
        <nav aria-label="Main navigation">
          <a href="#how-it-works">How it works</a>
          <a href="#possibilities">Possibilities</a>
          <a href="#trust">Built with care</a>
        </nav>
        <div>
          <Link className="landing-signin" href={user ? "/find" : "/login"}>
            {user ? "Your workspace" : "Sign in"}
          </Link>
          <Link className="primary-button" href={user ? "/find" : "/signup"}>
            {user ? "Find people" : "Get started"}
            <ArrowUpRight size={17} />
          </Link>
        </div>
      </header>
      <main id="landing-main">
        <section className="landing-hero">
          <div className="landing-hero-copy">
            <span className="eyebrow">
              <span className="eyebrow-dot" /> A little intention. A new
              connection.
            </span>
            <h1>
              Find your people.
              <br />
              <em>Start with a purpose.</em>
            </h1>
            <p>
              A skill to share. An idea to build. Something you want to try.
              Tell Telos what you have in mind, and discover people whose
              intentions meet yours.
            </p>
            <div className="landing-hero-actions">
              <Link href="/find" className="primary-button">
                Explore your next connection <ArrowRight size={19} />
              </Link>
              <a href="#how-it-works" className="text-button">
                See how it works <ArrowDown size={17} />
              </a>
            </div>
            <div className="landing-principles">
              <span>
                <Check size={16} /> You choose who to connect with
              </span>
              <span>
                <Check size={16} /> Your profile, your pace
              </span>
            </div>
          </div>
          <div
            className="landing-product"
            aria-label="Interactive example of intent matching"
          >
            <div className="product-window-heading">
              <span>
                <i />
                <i />
                <i />
              </span>
              <span>
                <Compass size={13} /> A connection in the making
              </span>
              <span />
            </div>
            <div className="product-window-body">
              <div
                className="example-tabs"
                role="tablist"
                aria-label="Example intentions"
              >
                {scenarios.map((scenario, index) => (
                  <button
                    id={`scenario-tab-${index}`}
                    role="tab"
                    tabIndex={example === index ? 0 : -1}
                    aria-selected={example === index}
                    aria-controls="scenario-panel"
                    key={scenario.label}
                    onClick={() => setExample(index)}
                    onKeyDown={(event) => {
                      const next =
                        event.key === "ArrowRight"
                          ? (index + 1) % scenarios.length
                          : event.key === "ArrowLeft"
                            ? (index + scenarios.length - 1) % scenarios.length
                            : event.key === "Home"
                              ? 0
                              : event.key === "End"
                                ? scenarios.length - 1
                                : null;
                      if (next === null) return;
                      event.preventDefault();
                      setExample(next);
                      document.getElementById(`scenario-tab-${next}`)?.focus();
                    }}
                  >
                    {scenario.label}
                  </button>
                ))}
              </div>
              <div
                id="scenario-panel"
                role="tabpanel"
                aria-labelledby={`scenario-tab-${example}`}
              >
                <div className="example-query">
                  <span>
                    <Search size={15} /> Your intention
                  </span>
                  <p>{current.request}</p>
                </div>
                <div className="example-bridge">
                  <span />
                  <Sparkles size={17} />
                  <span />
                </div>
                <div className="example-match">
                  <div className="example-match-heading">
                    <span className={`example-avatar ${current.color}`}>
                      {current.initials}
                    </span>
                    <div>
                      <strong>{current.role}</strong>
                      <span>{current.topic}</span>
                    </div>
                    <MoveUpRight size={19} />
                  </div>
                  <p>“{current.offer}”</p>
                  <div className="example-fit">
                    <Check size={14} /> Different intentions. A shared
                    possibility.
                  </div>
                </div>
              </div>
              <p className="example-caption">
                Illustrative example · Your results depend on active intentions.
              </p>
            </div>
          </div>
        </section>
        <div className="landing-divider">
          <span>A PLACE FOR WHAT YOU WANT TO DO NEXT</span>
          <span>Learn · Create · Work · Meet · Contribute</span>
        </div>
        <section className="landing-section" id="how-it-works">
          <div className="section-heading">
            <div>
              <span className="eyebrow">FROM AN IDEA TO A CONVERSATION</span>
              <h2>
                Less searching around.
                <br />
                More finding common ground.
              </h2>
            </div>
            <p>
              Start with the reason you want to connect. Let the conversation
              grow from there.
            </p>
          </div>
          <div className="landing-steps">
            {[
              {
                number: "01",
                icon: <Lightbulb />,
                title: "Say what you have in mind",
                text: "Write naturally. Ask for help, offer a skill, find a collaborator, or make room for something new.",
              },
              {
                number: "02",
                icon: <Fingerprint />,
                title: "Look for a useful fit",
                text: "Discover related requests and offers. Read each person's actual intention and see how your goals could connect.",
              },
              {
                number: "03",
                icon: <MessageCircle />,
                title: "Make the first move",
                text: "Send a thoughtful invitation. When they accept, continue in a private conversation and decide what happens next.",
              },
            ].map((step) => (
              <article key={step.number}>
                <div>
                  <span>{step.icon}</span>
                  <b>{step.number}</b>
                </div>
                <h3>{step.title}</h3>
                <p>{step.text}</p>
              </article>
            ))}
          </div>
        </section>
        <section
          className="landing-section landing-possibilities"
          id="possibilities"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">ONE PLACE. MANY POSSIBILITIES.</span>
              <h2>
                What could a connection
                <br />
                make possible for you?
              </h2>
            </div>
            <Link href={destination} className="text-button">
              Try an intention <ArrowUpRight size={19} />
            </Link>
          </div>
          <div className="possibility-grid">
            {[
              [
                "01 / LEARN & SHARE",
                "A little guidance goes a long way.",
                "Find a mentor, share what you know, or learn alongside someone.",
                "I want to practice conversational French with a learning partner.",
              ],
              [
                "02 / BUILD & WORK",
                "Good ideas need good people.",
                "Find collaborators, offer your skills, or explore a work opportunity.",
                "I'm a video editor looking to collaborate on a short film.",
              ],
              [
                "03 / MEET & CONTRIBUTE",
                "Make room for something meaningful.",
                "Meet people around an activity or help bring a community idea to life.",
                "Looking for people to join a weekend neighborhood clean-up.",
              ],
            ].map(([label, title, description, intent]) => (
              <Link
                key={label}
                href={`/find?intent=${encodeURIComponent(intent)}`}
                className="possibility-card"
              >
                <span>{label}</span>
                <h3>{title}</h3>
                <p>{description}</p>
                <div>
                  <span>Explore this intention</span>
                  <ArrowUpRight size={20} />
                </div>
              </Link>
            ))}
          </div>
        </section>
        <section className="landing-trust" id="trust">
          <div>
            <span className="eyebrow">
              <ShieldCheck size={16} /> CONNECT WITH CONTEXT
            </span>
            <h2>
              Made for people.
              <br />
              Built around choice.
            </h2>
            <p>Useful connections need more than a similar keyword.</p>
          </div>
          <div className="trust-points">
            <article>
              <Handshake />
              <div>
                <h3>A reason to reach out</h3>
                <p>
                  Matching considers related goals and complementary needs. You
                  can review their intention before sending an invitation.
                </p>
              </div>
            </article>
            <article>
              <Compass />
              <div>
                <h3>Nearby or anywhere</h3>
                <p>
                  Enter a city or choose device location for nearby discovery.
                  Keep your profile location optional and separate.
                </p>
              </div>
            </article>
            <article>
              <ShieldCheck />
              <div>
                <h3>You stay in control</h3>
                <p>
                  Accept invitations before chatting. Control profile
                  visibility, block or report people, and pause intentions when
                  plans change.
                </p>
              </div>
            </article>
          </div>
        </section>
        <section className="landing-closing">
          <span className="eyebrow">THE NEXT STEP CAN BE A SMALL ONE.</span>
          <h2>What do you have in mind?</h2>
          <p>
            There could be someone looking for exactly the connection you can
            offer.
          </p>
          <Link href="/find" className="primary-button">
            Start with your intention <ArrowRight size={19} />
          </Link>
        </section>
      </main>
      <footer className="landing-footer">
        <Link href="/" aria-label="Telos home">
          <Logo small />
        </Link>
        <p>Connections with a purpose.</p>
        <a href="#trust">Privacy & choice</a>
        <Link href="/find">
          Open Telos <ArrowUpRight size={15} />
        </Link>
      </footer>
    </div>
  );
}
