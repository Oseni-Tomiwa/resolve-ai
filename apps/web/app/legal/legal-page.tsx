import Link from 'next/link';
import { ResolveAILogo } from '../resolveai-logo';

export type LegalSection = { heading: string; body: string };

export function LegalPage({
  title,
  eyebrow,
  intro,
  sections,
}: {
  title: string;
  eyebrow: string;
  intro: string;
  sections: LegalSection[];
}) {
  return (
    <main className="site-shell legal-shell">
      <nav className="public-nav" aria-label="Main navigation">
        <Link className="brand" href="/" aria-label="ResolveAI home">
          <ResolveAILogo size="sm" decorative />
          <span>
            resolve<span className="brand-accent">ai</span>
          </span>
        </Link>
        <div className="nav-actions">
          <Link className="nav-signin" href="/login">
            Sign in
          </Link>
          <Link className="button button-small" href="/register">
            Get started <span aria-hidden="true">↗</span>
          </Link>
        </div>
      </nav>
      <article className="legal-content">
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="legal-intro">{intro}</p>
        <p className="legal-notice">
          This page is a launch-readiness draft and must be reviewed and
          approved by your legal counsel before production use.
        </p>
        {sections.map((section) => (
          <section key={section.heading}>
            <h2>{section.heading}</h2>
            <p>{section.body}</p>
          </section>
        ))}
      </article>
      <footer className="site-footer section-wrap">
        <Link className="brand" href="/">
          <ResolveAILogo size="sm" decorative />
          <span>
            resolve<span className="brand-accent">ai</span>
          </span>
        </Link>
        <div>
          <Link href="/privacy">Privacy</Link>
          <Link href="/terms">Terms</Link>
          <Link href="/acceptable-use">Acceptable use</Link>
          <Link href="/support">Support</Link>
        </div>
      </footer>
    </main>
  );
}
