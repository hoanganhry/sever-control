# PatchBuild Menu Control

A small Node.js web service for saving PatchBuild menu settings and serving them to connected menu clients. It includes an authenticated admin page, a read-only client API, validation for every setting, and JSON persistence on a Render disk.

## Deploy on Render

1. Push the project to a Git repository that Render can access.
2. Create a **Blueprint** from this repository. Render will use the top-level `render.yaml` and deploy the repository root.
3. Keep the generated values for `ADMIN_PASSWORD`, `CLIENT_API_TOKEN`, and `SESSION_SECRET`. The blueprint mounts a persistent disk at `/var/data`, so saved settings survive service restarts.
4. Open the new service URL. Sign in with the `ADMIN_PASSWORD` value from the service's Environment page.
5. Copy `CLIENT_API_TOKEN` from Environment. In the menu client's `AuroraRemoteControl.cs`, set `MzRemoteControlUrl` to the full service URL (for example, `https://your-service.onrender.com`) and replace `PASTE_CLIENT_API_TOKEN_HERE` with that token.
6. Rebuild and package the menu from its project, then install that build on the device. Once it is open, the dashboard reports the client as connected and saves are picked up within about eight seconds.

The token in the menu build can read the current settings. It cannot sign in to the dashboard or change settings. Treat the token as public once a build is distributed; rotate it in Render and rebuild if it needs to be replaced.

The blueprint uses a Render Starter web service and a 1 GB persistent disk. Render may charge for those resources. The disk is needed to retain settings through restarts.

## Local run

Requires Node.js 20 or later. Set these environment variables to long random values before starting the service:

- `ADMIN_PASSWORD` (at least 20 characters)
- `CLIENT_API_TOKEN` (at least 24 characters)
- `SESSION_SECRET` (at least 32 characters)
- Optional `DATA_DIR` (defaults to `.data` in this project)
- Optional `PORT` (defaults to `10000`)

Then run `npm start` from this directory and visit `http://localhost:10000`.

## Settings

The dashboard controls the menu's feature switches, aim FOV and range, head chance, target part, ESP range, line origin, health-bar position, FOV opacity, and FOV thickness. Mutually exclusive combinations follow the in-game menu behavior. “Tắt tất cả” clears the switches; save to publish that configuration.

The in-game client requests `GET /api/client/settings` over HTTPS with `Authorization: Bearer <CLIENT_API_TOKEN>`. The endpoint is read-only. Admin changes use the same-origin dashboard session and CSRF token.

Health check: `GET /healthz`.
