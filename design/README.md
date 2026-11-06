# Quik1 Claude Design source

`design/claude-design/` is the first Claude Design export and the visual source for the live Quik1 app. `design/claude-design-v2/` is the later “Loop — Revolving Credit” export, kept as a flow reference only. The live app keeps the first design’s look.

Path: Claude Design → this folder → pull request → Vercel preview → Craig Go → production.

Do not paste Anthropic keys into the browser.

The unpacked tree is kept intact (`app.dc.jsx`, `template.html`, fonts, images, and `assets/90741e73-54ba-4ee7-9480-fa0370bd38e4.mp4`). That splash video is already the file served from `quik1/`; it is not copied into `quik1/` again. This folder is Git only — `.vercelignore` leaves it out of the deployment, so `/quik1/` is unchanged.
