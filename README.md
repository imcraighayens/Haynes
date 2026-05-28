# Ecokode — Website

Marketing site for **Ecokode**, an IT · AI · Fleet Management company. Ecokode unifies
AI-powered fleet telematics, route optimization, EV transition and managed IT services
on a single, sustainable platform.

## Tech

A fast, fully **static** site — no build step, no framework, no runtime dependencies.

```
index.html              # All page content & sections
assets/css/styles.css   # Design system + components (CSS custom properties)
assets/js/main.js        # Nav, scroll reveal, animated counters, form handling
```

## Design system

Generated with the `ui-ux-pro-max` design-intelligence skill and refined for a
dark-first tech aesthetic:

- **Style:** Organic Biophilic × Modern Tech
- **Palette:** Emerald (`#10b981` / `#059669`) + Solar Gold (`#fbbf24`) on deep green-black
- **Type:** [Plus Jakarta Sans](https://fonts.google.com/specimen/Plus+Jakarta+Sans)
- **Accessibility:** WCAG AA contrast, keyboard focus states, `prefers-reduced-motion`
- **Responsive:** 375 / 768 / 1024 / 1440 breakpoints

## Run locally

It's plain static files — open `index.html` directly, or serve it:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

## Deploy

Drop the folder on any static host — GitHub Pages, Netlify, Vercel, Cloudflare Pages, S3.
No configuration required.

## Customize

- **Content:** edit `index.html` sections (hero, solutions, platform, pricing, contact).
- **Colors / spacing / radius:** change the CSS custom properties under `:root` in `styles.css`.
- **Contact form:** `main.js` currently simulates submission — wire the `submit` handler to
  your backend or a form service (Formspree, Basin, etc.).
