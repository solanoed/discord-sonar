# Discord Music Bot + Web Dashboard — Design

## Overview

Bot de música para Discord (discord.js + discord-player) controlado tanto por slash commands como por un dashboard web en tiempo real (React + socket.io). Ambas superficies de control mutan la misma cola de reproducción; los cambios se reflejan instantáneamente en la otra vía WebSocket.

## Goals

- Reproducir música desde YouTube, Spotify y SoundCloud en canales de voz de Discord.
- Permitir control total (play, skip, pause, queue, volumen) desde slash commands Y desde un dashboard web, con estado sincronizado en tiempo real.
- Soportar múltiples guilds simultáneamente, cada uno con su propia cola aislada.
- Dashboard protegido con Discord OAuth2 — solo administradores del guild pueden controlar su propia cola.
- Desplegable en infraestructura free-tier (Render/Railway + Vercel/Netlify).

## Non-goals

- No se implementa e2e testing automatizado de audio/voz real (requiere guild real, no es costo-efectivo).
- No se soporta login con otros proveedores además de Discord.
- No se implementa historial persistente de reproducción ni analíticas (fuera de alcance v1).

## Stack

- **Backend:** Node.js, TypeScript (CommonJS), discord.js, discord-player (+ extractores YouTube/Spotify/SoundCloud), socket.io, express.
- **Frontend:** React, TypeScript, Vite, socket.io-client.
- **Repo:** monorepo con pnpm workspaces (`backend/`, `frontend/`).
- **Auth:** Discord OAuth2 (authorization code flow) + JWT (httpOnly cookie).

## Repo layout

```
discord-music-dashboard/
  pnpm-workspace.yaml
  package.json
  backend/
    src/
      bot/            → discord.js Client, discord-player Player
      commands/        → slash commands (/play, /skip, /queue...)
      events/
        discord/       → ready, interactionCreate
        player/         → playerStart, queueEmpty, audioTrackAdd... (bridge to sockets)
      sockets/          → socket.io namespace, room-per-guild, action handlers
      http/
        routes/
        controllers/
        middleware/     → auth guard
      auth/             → Discord OAuth2 exchange, JWT issue/verify
      services/         → queueService, guildService (permission checks)
      config/           → env loader/validator
      types/
      index.ts
    tsconfig.json
    .env.example
  frontend/
    src/
      pages/
      components/
      hooks/            → useSocket, useGuildQueue
      context/          → auth context
      services/         → api client, socket client
      types/
    vite.config.ts
```

CommonJS + `tsc` en el backend (no ESM): discord.js y discord-player funcionan bien en CJS, evita fricción de imports/interop.

## Core architecture — single source of truth

`discord-player`'s `GuildQueue` es la única fuente de verdad. Ni slash commands ni el dashboard tocan la queue directamente: ambos llaman las mismas funciones de `queueService`.

```
/play command  ──┐
                  ├──> queueService.addTrack(guildId, query) ──> GuildQueue (discord-player)
Dashboard POST ──┘                                                    │
                                                                       │ emits: audioTrackAdd,
                                                                       │ playerStart, playerSkip,
                                                                       │ queueEmpty, disconnect...
                                                                       ▼
                                                          playerEventBridge (registrado 1 vez,
                                                          al boot, escucha en player.events)
                                                                       │
                                                                       ▼
                                                     io.to(`guild:${guildId}`).emit('queue:state', snapshot)
                                                                       │
                                                                       ▼
                                                        React dashboard useGuildQueue hook
                                                        actualiza state → re-render
```

Reglas:

- `queueService` expone funciones puras: `addTrack`, `skip`, `pause`, `resume`, `setVolume`, `remove`, `shuffle`. Comandos slash y controllers REST llaman estas mismas funciones — cero lógica duplicada.
- `playerEventBridge` es un único listener global (no uno por request) — evita fugas de listeners y doble-emit.
- El snapshot enviado al dashboard normaliza el estado (track actual, progreso, cola completa, volumen, playing/paused/idle) — no expone objetos internos de discord-player.
- Rooms de socket.io por `guild:<id>` — el dashboard solo recibe updates del guild que tiene abierto.

## Auth flow (Discord OAuth2)

```
Dashboard "Login" → redirect Discord OAuth authorize URL (scope: identify, guilds)
    ↓ user aprueba
Discord redirect → GET /api/auth/callback?code=...
    ↓
backend intercambia code por access_token (Discord API)
    ↓
fetch /users/@me + /users/@me/guilds
    ↓
guildService.getMutualAdminGuilds(userGuilds, botGuilds)
    → filtra: guilds donde el bot está Y usuario tiene MANAGE_GUILD o rol admin configurado
    ↓
issue JWT (httpOnly cookie) con { userId, adminGuildIds[] }
    ↓
redirect a /dashboard
```

Detalles:

- JWT corto (~1h) + refresh silencioso vía `/api/auth/refresh` (el access_token de Discord se guarda server-side, nunca en la cookie del cliente).
- Middleware `requireGuildAdmin(guildId)` valida el JWT y que `guildId` esté en `adminGuildIds` antes de cualquier ruta REST o acción de socket.
- Socket.io: el JWT se pasa en `handshake.auth.token`, verificado en middleware de conexión antes de permitir join a la room `guild:<id>`.
- Sin librerías de auth de terceros (no Passport) — el exchange OAuth2 de Discord es un fetch simple, menos dependencias.

## Error handling

| Fuente | Manejo |
|---|---|
| Extractor falla (edad-restringido, región, link roto) | `queueService` captura, emite `player:error` con mensaje normalizado → toast en dashboard, reply efímero en slash command |
| Bot sin permiso de voz (Connect/Speak) | Chequeo previo en `queueService.join()`, error 4xx claro antes de intentar conectar |
| Discord API rate limit / caída | discord.js maneja retry interno; el bridge loggea y emite `bot:disconnected` si el Client pierde conexión |
| OAuth callback falla / token inválido | Redirect a `/login?error=...`, sin exponer detalle interno |
| Socket sin JWT válido o guild no autorizado | Conexión rechazada en middleware, evento `auth:error` antes de disconnect |
| Guild sin queue activa (dashboard pide estado) | Snapshot vacío por defecto ("idle"), no es un error |

## Testing strategy

- **Unit (vitest):** funciones puras de `queueService`, `guildService` (permisos), formateo de snapshot. `GuildQueue` de discord-player mockeada.
- **Integración manual:** voz/audio real requiere un guild real — no automatizable de forma costo-efectiva. Checklist manual por fase (play, skip, pause, dashboard-sync, reconexión).
- **Frontend:** tests de hooks (`useGuildQueue`) con `socket.io-client` mockeado; sin e2e completo por ahora (fuera de alcance v1).

## Roadmap de fases

Implementación incremental — cada fase se dispara explícitamente por el usuario, no se adelanta la siguiente sin confirmación.

| Fase | Contenido |
|---|---|
| 1 | Backend init: estructura, package.json, `index.ts` (Client + Player + Express básico), variables de entorno |
| 2 | Socket.io: server setup, rooms por guild, `playerEventBridge`, eventos base |
| 3 | REST API + Auth: OAuth2 flow, JWT, middleware, rutas de guilds/queue |
| 4 | Slash commands: `/play`, `/skip`, `/pause`, `/queue`, `/volume`, etc. usando `queueService` |
| 5 | Frontend dashboard: Vite+React, login, lista de guilds, UI de queue/player en tiempo real |
| 6 | Deploy free-tier: Render/Railway (backend+bot), Vercel/Netlify (frontend), consideraciones de sleep/wake-up en free tier |

## Open questions / risks

- Free-tier hosts (Render/Railway free) duermen tras inactividad — reconexión de voz tras cold-start necesita manejo explícito (a resolver en Fase 6).
- Límites de rate-limit de Spotify/SoundCloud vía discord-player extractors no confirmados en producción — validar en Fase 1-2 con uso real.
