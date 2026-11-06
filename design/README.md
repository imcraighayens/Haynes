# Quik1 Claude Design source

`design/claude-design/` is the Claude Design export and the source of truth for future Quik1 UI work. The live borrower UI is built from it into `quik1/`.

Path: Claude Design → this folder → pull request → Vercel preview → Craig Go → production.

Do not paste Anthropic keys into the browser.

The unpacked tree is kept intact (`app.dc.jsx`, `template.html`, fonts, images, and `assets/90741e73-54ba-4ee7-9480-fa0370bd38e4.mp4`). That splash video is already the file served from `quik1/`; it is not copied into `quik1/` again. This folder is Git only — `.vercelignore` leaves it out of the deployment, so `/quik1/` is unchanged.
