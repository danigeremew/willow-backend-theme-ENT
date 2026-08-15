/** @odoo-module **/

/**
 * Inline SVG hero art. Gradient/filter IDs are prefixed so multiple mounts
 * (band / shell / home) can coexist without clashing.
 */
export function buildHeroArtMarkup(idPrefix) {
    const p = String(idPrefix || "wl-hero-");
    return `
<div class="wl_erp_hero_art" aria-hidden="true" data-wl-hero-art="${p}">
  <svg
    class="wl_erp_hero_art_svg"
    viewBox="0 0 2048 684"
    preserveAspectRatio="xMidYMid slice"
    aria-hidden="true"
    focusable="false"
  >
    <defs>
      <linearGradient id="${p}base" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="var(--hero-surface-start)"/>
        <stop offset=".52" stop-color="var(--hero-surface-mid)"/>
        <stop offset="1" stop-color="var(--hero-surface-end)"/>
      </linearGradient>
      <linearGradient id="${p}left-ribbon" x1=".1" y1=".1" x2=".9" y2=".9">
        <stop offset="0" stop-color="var(--hero-accent-strong)" stop-opacity=".55"/>
        <stop offset=".48" stop-color="var(--hero-accent)" stop-opacity=".34"/>
        <stop offset="1" stop-color="var(--hero-accent-soft)" stop-opacity=".16"/>
      </linearGradient>
      <linearGradient id="${p}center-ribbon" x1=".05" y1=".05" x2=".9" y2=".95">
        <stop offset="0" stop-color="var(--hero-accent)" stop-opacity=".22"/>
        <stop offset=".52" stop-color="var(--hero-accent-soft)" stop-opacity=".14"/>
        <stop offset="1" stop-color="var(--hero-highlight)" stop-opacity=".4"/>
      </linearGradient>
      <radialGradient id="${p}left-glow" cx=".04" cy=".86" r=".8">
        <stop offset="0" stop-color="var(--hero-accent-strong)" stop-opacity=".36"/>
        <stop offset=".6" stop-color="var(--hero-accent)" stop-opacity=".1"/>
        <stop offset="1" stop-color="var(--hero-accent)" stop-opacity="0"/>
      </radialGradient>
      <radialGradient id="${p}center-glow" cx=".56" cy=".52" r=".7">
        <stop offset="0" stop-color="var(--hero-highlight)" stop-opacity=".7"/>
        <stop offset="1" stop-color="var(--hero-highlight)" stop-opacity="0"/>
      </radialGradient>
      <filter id="${p}soften" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="34"/>
      </filter>
    </defs>
    <rect width="2048" height="684" fill="url(#${p}base)"/>
    <rect width="2048" height="684" fill="url(#${p}left-glow)"/>
    <path
      d="M 206 -28
         C 80 128, 3 318, -22 494
         L -22 584
         C 38 330, 207 129, 505 -28
         Z"
      fill="url(#${p}left-ribbon)"
    />
    <path
      d="M 982 -28
         C 699 186, 565 430, 617 720
         L 1410 720
         C 1370 468, 1417 221, 1542 -28
         Z"
      fill="url(#${p}center-ribbon)"
    />
    <ellipse
      cx="1090" cy="348" rx="455" ry="310"
      fill="url(#${p}center-glow)"
      filter="url(#${p}soften)"
    />
    <ellipse
      cx="1900" cy="330" rx="400" ry="340"
      fill="url(#${p}center-glow)"
      opacity=".58"
      filter="url(#${p}soften)"
    />
    <g
      fill="none"
      stroke="var(--hero-seam)"
      stroke-width="5"
      stroke-linecap="round"
      opacity="var(--hero-seam-opacity)"
    >
      <path d="M 206 -28 C 80 128, 3 318, -22 494"/>
      <path d="M 505 -28 C 207 129, 38 330, -22 584"/>
      <path d="M 982 -28 C 699 186, 565 430, 617 720"/>
      <path d="M 1542 -28 C 1417 221, 1370 468, 1410 720"/>
    </g>
  </svg>
</div>`;
}

export function ensureHeroArt(container, idPrefix, { prepend = true } = {}) {
    if (!container) {
        return null;
    }
    const existing = container.querySelector(`:scope > .wl_erp_hero_art[data-wl-hero-art="${idPrefix}"]`);
    if (existing) {
        return existing;
    }
    const wrap = document.createElement("div");
    wrap.innerHTML = buildHeroArtMarkup(idPrefix).trim();
    const node = wrap.firstElementChild;
    if (prepend && container.firstChild) {
        container.insertBefore(node, container.firstChild);
    } else {
        container.appendChild(node);
    }
    return node;
}
