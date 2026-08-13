import Link from 'next/link';
import { ResolveAILogo } from './resolveai-logo';

const features = [
  { number: '01', title: 'Grounded answers', copy: 'Give your team an AI copilot that knows your product, policies, and tone.' },
  { number: '02', title: 'Human when it matters', copy: 'Move complex conversations to the right teammate with context intact.' },
  { number: '03', title: 'One calm workspace', copy: 'Keep conversations, teammates, and customer signal together as you scale.' },
];

export default function Home() {
  return <main className="site-shell">
    <nav className="public-nav" aria-label="Main navigation">
      <Link className="brand" href="/" aria-label="ResolveAI home"><ResolveAILogo size="sm" decorative /><span>resolve<span className="brand-accent">ai</span></span></Link>
      <div className="nav-links"><a href="#product">Product</a><a href="#why-resolve">Why ResolveAI</a></div>
      <div className="nav-actions"><Link className="nav-signin" href="/login">Sign in</Link><Link className="button button-small" href="/register">Get started <span aria-hidden="true">↗</span></Link></div>
    </nav>

    <section className="hero section-wrap">
      <div className="hero-copy">
        <div className="eyebrow"><span className="eyebrow-dot" /> The support workspace for growing teams</div>
        <h1>Resolve more.<br /><em>Stress less.</em></h1>
        <p className="hero-lede">ResolveAI brings your AI support agent and human team into one clear, capable workspace—so every customer gets a better answer.</p>
        <div className="hero-actions"><Link className="button" href="/register">Get started free <span aria-hidden="true">↗</span></Link><Link className="text-link" href="/login">Sign in to your workspace <span aria-hidden="true">→</span></Link></div>
        <p className="hero-note"><span aria-hidden="true">✦</span> Built for support teams that care about the details</p>
      </div>
      <div className="hero-visual" aria-label="ResolveAI workspace preview">
        <div className="glow glow-one" /><div className="glow glow-two" />
        <div className="preview-window">
          <div className="preview-top"><div className="window-dots"><i /><i /><i /></div><span>Acme support workspace</span><span className="online-pill"><b /> Live</span></div>
          <div className="preview-body">
            <aside className="preview-sidebar"><div className="mini-logo"><ResolveAILogo size="xs" decorative /></div><div className="mini-line active" /><div className="mini-line" /><div className="mini-line" /><div className="mini-spacer" /><div className="mini-line" /></aside>
            <div className="preview-main"><div className="preview-heading"><div><small>OVERVIEW</small><strong>Good morning, Maya</strong></div><span className="avatar">MC</span></div><div className="metric-row"><div><small>Open conversations</small><strong>128</strong><span className="metric-up">↗ 12.4%</span></div><div><small>AI resolution rate</small><strong>84.6%</strong><span className="metric-up">↗ 8.2%</span></div></div><div className="conversation-card"><div className="card-label"><span>RECENT CONVERSATIONS</span><span>View all →</span></div><div className="conversation"><span className="conversation-avatar purple">JD</span><div><strong>Jordan Davis</strong><p>“Thanks, that solved it!”</p></div><span className="status-dot" /></div><div className="conversation"><span className="conversation-avatar teal">SK</span><div><strong>Sam Kim</strong><p>Question about my workspace...</p></div><span className="status-dot" /></div></div></div>
          </div>
        </div>
      </div>
    </section>

    <section className="trust-strip section-wrap" aria-label="ResolveAI benefits"><span>MADE FOR THE MOMENTS THAT MATTER</span><div><strong>24/7</strong><small>always-on support</small></div><div><strong>84%</strong><small>faster first response</small></div><div><strong>1</strong><small>calm workspace</small></div></section>

    <section className="feature-section section-wrap" id="product"><div className="section-intro"><div className="eyebrow">The ResolveAI difference</div><h2>Your customers feel the difference.</h2><p>Everything you need to make support feel personal at every stage of growth.</p></div><div className="feature-grid">{features.map((feature) => <article className="feature-card" key={feature.number}><span className="feature-number">{feature.number}</span><h3>{feature.title}</h3><p>{feature.copy}</p><span className="feature-arrow" aria-hidden="true">↗</span></article>)}</div></section>

    <section className="closing-section section-wrap" id="why-resolve"><div><div className="eyebrow">A better way to support</div><h2>Make every answer<br /><em>feel effortless.</em></h2></div><Link className="button" href="/register">Start resolving <span aria-hidden="true">↗</span></Link></section>
    <footer className="site-footer section-wrap"><Link className="brand" href="/"><ResolveAILogo size="sm" decorative /><span>resolve<span className="brand-accent">ai</span></span></Link><span>© 2026 ResolveAI. Support, made clear.</span><div><Link href="/login">Sign in</Link><Link href="/register">Create account</Link><Link href="/privacy">Privacy</Link><Link href="/terms">Terms</Link><Link href="/support">Support</Link></div></footer>
  </main>;
}
