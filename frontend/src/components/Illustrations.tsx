/** Lightweight inline illustrations that match the design reference (plant + laptop, map pin, WFH desk). */

/** Asten Labs logo recoloured for dark/blue backgrounds (public/logo-light.png): white mark, sky-blue wave. */
export function Logo({ width = 150 }: { width?: number }) {
  return <img className="logo-img" src="/logo-light.png" alt="Asten Labs" style={{ width }} />
}

export function WelcomeIllustration() {
  return (
    <svg viewBox="0 0 320 220" className="illustration" aria-hidden="true">
      <circle cx="170" cy="115" r="95" fill="#e0ecff" />
      <path d="M255 190c-6-40-2-70 12-95 6 28 10 58-12 95z" fill="#34a853" />
      <path d="M265 190c8-30 24-48 46-58-6 28-20 48-46 58z" fill="#7bcf8e" />
      <path d="M246 190c-14-24-34-34-58-36 8 22 28 34 58 36z" fill="#2f9e5b" />
      <rect x="240" y="186" width="42" height="26" rx="5" fill="#fff" stroke="#cfd8e8" />
      <rect x="82" y="104" width="130" height="82" rx="8" fill="#1e2b4d" />
      <rect x="90" y="112" width="114" height="66" rx="4" fill="#3b82f6" />
      <path d="M90 150l30-24 28 16 20-12 36 24v24H90z" fill="#60a5fa" />
      <path d="M62 190h170l-14 12H76z" fill="#cbd5e1" />
      <rect x="60" y="150" width="24" height="36" rx="3" fill="#fff" stroke="#cfd8e8" />
      <path d="M66 160h12M66 168h12M66 176h8" stroke="#94a3b8" strokeWidth="2" />
    </svg>
  )
}

export function MapIllustration() {
  return (
    <svg viewBox="0 0 280 220" className="illustration" aria-hidden="true">
      <circle cx="150" cy="120" r="92" fill="#e0ecff" />
      <path d="M70 150l50-26 52 22 52-26v62l-52 26-52-22-50 26z" fill="#fff" stroke="#c7d6ee" strokeWidth="2" />
      <path d="M120 124v62M172 146v62" stroke="#c7d6ee" strokeWidth="2" />
      <path d="M90 168c30-30 56 10 90-20" stroke="#60a5fa" strokeWidth="3" fill="none" strokeDasharray="5 5" />
      <path d="M150 40c-22 0-38 16-38 36 0 26 38 62 38 62s38-36 38-62c0-20-16-36-38-36z" fill="#ef4444" />
      <circle cx="150" cy="76" r="14" fill="#fff" />
    </svg>
  )
}

export function HomeDeskIllustration() {
  return (
    <svg viewBox="0 0 260 200" className="illustration" aria-hidden="true">
      <circle cx="140" cy="105" r="85" fill="#e0ecff" />
      <path d="M118 70l42-36 42 36v46h-84z" fill="#fff" stroke="#c7d6ee" strokeWidth="2" />
      <rect x="148" y="86" width="24" height="30" fill="#3b82f6" />
      <path d="M110 74l50-44 50 44" stroke="#2563eb" strokeWidth="9" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="70" y="146" width="150" height="10" rx="4" fill="#94a3b8" />
      <rect x="96" y="118" width="64" height="28" rx="4" fill="#1e2b4d" />
    </svg>
  )
}

export function BigCheck() {
  return (
    <svg width="76" height="76" viewBox="0 0 76 76" aria-hidden="true">
      <circle cx="38" cy="38" r="36" fill="#22a95c" />
      <path d="M22 39l11 11 21-23" stroke="#fff" strokeWidth="7" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  )
}
