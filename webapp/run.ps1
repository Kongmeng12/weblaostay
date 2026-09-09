# Runs the guest web app against the local API.
#
# Unlike the two Flutter apps, this one needs no CORS setup and no fixed
# port: vite.config.ts proxies /api and /uploads to http://localhost:3100
# server-side, so the browser only ever talks to localhost:5174 — one
# origin, no cross-origin request at all. The only requirement is that the
# backend actually be running on :3100 (see backend/deploy/start.ps1).
#
# Usage: .\run.ps1

npm run dev
