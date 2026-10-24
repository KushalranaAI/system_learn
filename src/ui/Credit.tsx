import type { ReactNode } from "react";
import { BRAND, type BrandLinkId } from "../brand";

/** Small hand-drawn brand marks (lucide has no brand icons). Filled, 24x24, coloured by `currentColor`. */
const MARKS: Record<BrandLinkId, ReactNode> = {
  linkedin: (
    <>
      <rect x="2.5" y="9" width="4" height="12.5" rx="0.6" />
      <circle cx="4.5" cy="4.6" r="2.3" />
      <path d="M9.5 9h3.8v1.8c.6-1.1 2-2.1 4-2.1 3.7 0 4.7 2.4 4.7 5.6v6.2h-4v-5.5c0-1.4-.2-2.6-1.8-2.6-1.7 0-2.1 1.2-2.1 2.6v5.5h-4V9z" />
    </>
  ),
  x: <path d="M18.9 1.15h3.68l-8.04 9.19L24 22.85h-7.4l-5.8-7.58-6.64 7.58H.47l8.6-9.83L0 1.15h7.6l5.24 6.93 6.06-6.93zm-1.29 19.5h2.04L6.49 3.24H4.3l13.31 17.41z" />,
  medium: (
    <>
      <circle cx="7.4" cy="12" r="5.6" />
      <ellipse cx="16.6" cy="12" rx="2.9" ry="5.3" />
      <rect x="21" y="6.9" width="1.7" height="10.2" rx="0.85" />
    </>
  ),
  youtube: <path fillRule="evenodd" d="M21.6 7.2a2.5 2.5 0 0 0-1.8-1.8C18.2 5 12 5 12 5s-6.2 0-7.8.4A2.5 2.5 0 0 0 2.4 7.2C2 8.8 2 12 2 12s0 3.2.4 4.8a2.5 2.5 0 0 0 1.8 1.8C5.8 19 12 19 12 19s6.2 0 7.8-.4a2.5 2.5 0 0 0 1.8-1.8C22 15.2 22 12 22 12s0-3.2-.4-4.8zM10 15V9l5.2 3L10 15z" />,
};

/** The credit strip at the bottom of every page: small, quiet, and out of the way of the content. */
export function Credit() {
  return (
    <footer className="credit">
      <span className="credit-text">
        Built by <a href={BRAND.links[0].href} target="_blank" rel="noopener noreferrer">{BRAND.name}</a>
      </span>
      <nav className="credit-links" aria-label={`${BRAND.name} on the web`}>
        {BRAND.links.map((l) => (
          <a key={l.id} href={l.href} target="_blank" rel="noopener noreferrer me" title={`${BRAND.name} on ${l.label}`} aria-label={`${BRAND.name} on ${l.label}`}>
            <svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden>{MARKS[l.id]}</svg>
          </a>
        ))}
      </nav>
    </footer>
  );
}
