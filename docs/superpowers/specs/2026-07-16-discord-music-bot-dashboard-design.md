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
      sockets/          → socket.io server, room-per-guild join/leave, playerEventBridge
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

## Fase 2 — WebSockets (detalle confirmado)

Alcance de Fase 2: solo infraestructura de sincronización en tiempo real (rooms + bridge de eventos del player). Sin acciones de mutar cola todavía — `queueService.addTrack/skip/pause/...` no existen hasta que exista una forma de poblar la cola (Fase 3 REST o Fase 4 slash commands). Fase 2 es puramente read-only: el dashboard se une a una room y recibe snapshots, nada más.

**Archivos:**

```
backend/src/http/createHttpServer.ts   → http.createServer(app), para que socket.io comparta el puerto con Express
backend/src/sockets/buildQueueSnapshot.ts → función pura: GuildQueue | null → QueueSnapshot
backend/src/sockets/createSocketServer.ts → factory de socket.io Server + manejo de guild:join/guild:leave
backend/src/sockets/playerEventBridge.ts  → listener único sobre player.events, empuja snapshot a la room del guild
backend/src/index.ts (modificado)         → usa httpServer + io + bridge en vez de app.listen directo
```

**Snapshot normalizado** (nunca expone objetos internos de discord-player):

```ts
type QueueSnapshotTrack = {
  id: string;
  title: string;
  author: string;
  url: string;
  thumbnail: string;
  durationMs: number;
};

type QueueSnapshot = {
  status: 'idle' | 'playing' | 'paused';
  currentTrack: QueueSnapshotTrack | null;
  queue: QueueSnapshotTrack[];
  volume: number;
  progressMs: number;
};
```

`buildQueueSnapshot(queue: GuildQueue | null)`: si `queue` es `null` (guild sin cola activa) devuelve `{ status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 }`. Si no, deriva `status` de `queue.node.isPaused()` / `queue.node.isPlaying()`, mapea `queue.currentTrack` y `queue.tracks.toArray()` a `QueueSnapshotTrack[]` usando los campos reales de `Track` (`id`, `title`, `author`, `url`, `thumbnail`, `durationMS`), y `progressMs` desde `queue.node.playbackTime`.

**Eventos bridgeados** — discord-player v7 `GuildQueueEvent` (confirmado contra los tipos instalados en Fase 1, `backend/node_modules/discord-player`): `PlayerStart`, `AudioTrackAdd`, `AudioTracksAdd`, `AudioTrackRemove`, `PlayerSkip`, `PlayerPause`, `PlayerResume`, `VolumeChange`, `EmptyQueue`, `Disconnect`, `PlayerError`. `registerPlayerEventBridge(player, io)` se registra una sola vez al boot (mismo principio que Fase 1: un único listener global, nunca uno por request). Para cada evento reconstruye el snapshot a partir de `queue` (el primer argumento de todo handler de `GuildQueueEvent`) y emite `io.to(\`guild:${queue.guild.id}\`).emit('queue:state', snapshot)`.

**Socket protocol (sin auth todavía):**

- Cliente conecta y emite `guild:join` con `{ guildId: string }` → server hace `socket.join(\`guild:${guildId}\`)` y responde inmediatamente con el snapshot actual de ese guild (via `buildQueueSnapshot`, `null` → idle si el guild no tiene cola activa aún).
- Cliente puede emitir `guild:leave` con `{ guildId: string }` → `socket.leave(...)`.
- `guild:join` sin `guildId` válido (string no vacío) → server emite `error` al socket, no ejecuta `join()`.
- **Nota de seguridad temporal:** sin JWT todavía, cualquiera que conozca un `guildId` puede unirse a su room y ver el snapshot. Aceptable en Fase 2 porque no hay acción de escritura ni datos sensibles en el snapshot (solo metadata de tracks públicos). Se blinda con el middleware JWT de Fase 3 (`handshake.auth.token`) sin cambiar la estructura de rooms/eventos aquí definida.

**Testing (Fase 2):**

- `buildQueueSnapshot`: tests unitarios con objetos `GuildQueue`-shaped fake — casos `null` → idle, playing, paused. Sin discord.js/discord-player real.
- `playerEventBridge`: test emitiendo un evento fake por `player.events.emit(GuildQueueEvent.PlayerStart, fakeQueue, fakeTrack)`, verificando que `io.to(guild:<id>).emit('queue:state', snapshot)` se llamó con el snapshot esperado — `io` mockeado (`{ to: vi.fn(() => ({ emit: vi.fn() })) }`).
- `createSocketServer`: test de integración con `socket.io-client` real contra un servidor efímero (puerto aleatorio) — conecta, emite `guild:join`, verifica que recibe `queue:state` inicial y quedó en la room correcta.

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

## Fase 3a — Auth (detalle confirmado)

Fase 3 se divide en dos sub-fases independientes: **3a (este addendum)** cubre login OAuth2 + JWT + middleware + listado de guilds admin. **3b** (después, con confirmación aparte) cubre `queueService` real (join de voz, play/skip/pause/volumen) + rutas REST de queue — se testea aparte porque no depende de que el auth funcione.

**Env vars nuevas:** `DISCORD_CLIENT_SECRET` (string, requerida), `JWT_SECRET` (string, requerida), `FRONTEND_URL` (default `http://localhost:5173`), `BACKEND_BASE_URL` (default `http://localhost:3001` — debe registrarse `BACKEND_BASE_URL + /api/auth/callback` como redirect URI en el Discord Developer Portal).

**Archivos:**

```
backend/src/auth/
  discordOAuth.ts   → buildAuthorizeUrl(state), exchangeCodeForToken(code), refreshAccessToken(refreshToken), fetchDiscordUser(accessToken), fetchUserGuilds(accessToken) — wrappers sobre fetch nativo de Node (sin librería HTTP nueva)
  jwt.ts            → signSessionToken(payload), verifySessionToken(token, opts?) — wrap de jsonwebtoken
  tokenStore.ts     → Map en memoria: saveTokens(userId, {accessToken, refreshToken, expiresAt}), getTokens(userId) — tokens de Discord nunca salen del server
backend/src/services/
  guildService.ts   → getMutualAdminGuilds(userGuilds, botGuildIds), hasManageGuildPermission(permissionsBitfield) — funciones puras
backend/src/http/
  middleware/requireAuth.ts → lee JWT de cookie "session", verifica, setea req.user = {userId, adminGuildIds}
  routes/authRoutes.ts      → GET /api/auth/login, GET /api/auth/callback, POST /api/auth/refresh, POST /api/auth/logout, GET /api/auth/me
  createApp.ts (modificado) → monta cookie-parser + authRoutes
backend/src/index.ts (modificado) → pasa el discord.js Client existente a createApp/authRoutes (guildService necesita client.guilds.cache para saber en qué guilds está el bot)
```

Nuevas deps: `jsonwebtoken`, `cookie-parser` (+ `@types/jsonwebtoken`, `@types/cookie-parser`).

Nota de naming: `requireAuth` (esta fase) solo autentica — verifica JWT y setea `req.user`. El `requireGuildAdmin(guildId)` mencionado en la sección "Auth flow" de arriba es autorización por guild y se construye en Fase 3b sobre `req.user.adminGuildIds` (ahí sí aplica, porque recién en 3b existen rutas guild-scoped que mutan la queue).

**Protección CSRF (decisión de seguridad agregada en esta fase, no estaba explícita antes):** el flujo OAuth2 necesita un parámetro `state` — sin eso, cualquiera puede forzar un login ajeno redirigiendo a la víctima a un `/callback` con un `code` propio. `/login` genera `state` random y lo guarda en cookie httpOnly `oauth_state` de vida corta (5 min); `/callback` verifica que el `state` del query coincida antes de continuar.

**Flow completo:**

```
GET /api/auth/login
  → genera state random (crypto.randomBytes)
  → seta cookie httpOnly "oauth_state" (5 min, sameSite=lax)
  → redirect a Discord authorize URL (scope=identify+guilds, state=state, redirect_uri=BACKEND_BASE_URL/api/auth/callback)

GET /api/auth/callback?code=...&state=...
  → compara state del query vs cookie "oauth_state" → si no coincide o falta: 400, borra cookie, no continúa
  → exchangeCodeForToken(code) → { access_token, refresh_token, expires_in }
  → fetchDiscordUser(access_token) → { id, username, ... }
  → fetchUserGuilds(access_token) → DiscordUserGuild[]
  → botGuildIds = client.guilds.cache.map(g => g.id)
  → adminGuildIds = guildService.getMutualAdminGuilds(userGuilds, botGuildIds)
  → tokenStore.saveTokens(userId, { accessToken, refreshToken, expiresAt })
  → JWT = signSessionToken({ userId, adminGuildIds }), expira 1h
  → seta cookie httpOnly "session" (sameSite=lax, secure en producción)
  → borra cookie "oauth_state"
  → redirect a FRONTEND_URL

POST /api/auth/refresh (requiere cookie "session", aunque esté vencida)
  → verifySessionToken(token, { ignoreExpiration: true }) → { userId, adminGuildIds }
  → tokenStore.getTokens(userId) → si no existe: 401 (nunca logueó o el server reinició — memoria in-process, se pierde al reiniciar)
  → refreshAccessToken(storedRefreshToken) → nuevos tokens Discord
  → tokenStore.saveTokens(userId, nuevos tokens)
  → nueva JWT con mismos adminGuildIds, nueva cookie "session"

POST /api/auth/logout
  → borra cookie "session", tokenStore no se toca (Discord no expone un revoke simple acá, no es crítico)

GET /api/auth/me (requireAuth)
  → devuelve { userId, adminGuildIds } del req.user
```

**Cookie `session`:** httpOnly, `sameSite=lax` (necesario — `strict` rompe el redirect cross-site desde Discord), `secure` solo si `NODE_ENV=production`.

**Límite conocido de `tokenStore` en memoria:** se pierde en cada restart del backend (free-tier duerme tras inactividad) y no funciona con más de una instancia corriendo. Aceptable para v1 — el usuario simplemente re-loguea. Documentado como limitación conocida, no un bug.

**Error handling (Fase 3a):**

| Fuente | Manejo |
|---|---|
| `state` no coincide o falta en `/callback` | 400, cookie `oauth_state` borrada, no se intenta exchange |
| `exchangeCodeForToken` falla (code inválido/expirado) | 400 con mensaje genérico, redirect a `FRONTEND_URL/login?error=oauth_failed` |
| Usuario sin guilds en común con el bot | Login igual exitoso, `adminGuildIds: []` — no es error |
| `/refresh` sin sesión guardada en `tokenStore` (server reinició) | 401, frontend debe forzar re-login completo |
| `requireAuth` sin cookie o JWT inválido/vencido | 401 `{ message: 'unauthorized' }` |
| Discord API caída durante exchange/fetch guilds | 502, mensaje genérico, no se crea sesión |

**Testing (Fase 3a):**

- `guildService`: funciones puras, tests con arrays fake de `DiscordUserGuild` — casos: bot no está en el guild, usuario sin `MANAGE_GUILD`, usuario owner, usuario admin real.
- `jwt.ts`: sign/verify roundtrip real (no mock) — sign, verify devuelve mismo payload; verify con secret incorrecto o token vencido tira error; `ignoreExpiration` funciona.
- `tokenStore.ts`: save/get roundtrip, get de userId inexistente devuelve `undefined`.
- `discordOAuth.ts`: `fetch` global mockeado (`vi.spyOn(global, 'fetch')`) — no pega a la API real de Discord en tests. Verifica URL/headers/body correctos y parseo de la respuesta.
- `requireAuth` middleware: test de integración con supertest contra una app Express real montando una ruta protegida fake — con cookie válida pasa, sin cookie/inválida 401.
- `authRoutes`: integración con supertest — `/login` redirige con cookie `oauth_state` seteada; `/callback` con state mockeado completo (fetch mockeado) setea cookie `session` y redirige a `FRONTEND_URL`; `/me` protegido funciona.

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
| 2 | Socket.io: server setup, rooms por guild, `playerEventBridge`, eventos base (detalle: ver sección "Fase 2 — WebSockets") |
| 3a | Auth: OAuth2 flow, JWT, middleware, listado de guilds admin (detalle: ver sección "Fase 3a — Auth") |
| 3b | `queueService` real (join voz, play/skip/pause/volumen) + rutas REST de queue |
| 4 | Slash commands: `/play`, `/skip`, `/pause`, `/queue`, `/volume`, etc. usando `queueService` |
| 5 | Frontend dashboard: Vite+React, login, lista de guilds, UI de queue/player en tiempo real |
| 6 | Deploy free-tier: Render/Railway (backend+bot), Vercel/Netlify (frontend), consideraciones de sleep/wake-up en free tier |

## Open questions / risks

- Free-tier hosts (Render/Railway free) duermen tras inactividad — reconexión de voz tras cold-start necesita manejo explícito (a resolver en Fase 6).
- Límites de rate-limit de Spotify/SoundCloud vía discord-player extractors no confirmados en producción — validar en Fase 1-2 con uso real.
