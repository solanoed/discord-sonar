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

- `queueService` expone funciones puras: `addTrack`, `skip`, `pause`, `resume`, `setVolume`, `remove`, `shuffle`, `stop`. Comandos slash y controllers REST llaman estas mismas funciones — cero lógica duplicada.
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
- **Nota de seguridad temporal:** sin JWT todavía, cualquiera que conozca un `guildId` puede unirse a su room y ver el snapshot. Aceptable en Fase 2 porque no hay acción de escritura ni datos sensibles en el snapshot (solo metadata de tracks públicos). Se blinda en Fase 5b (ver esa sección) sin cambiar la estructura de rooms/eventos aquí definida — vía la cookie httpOnly `session` en el handshake, no vía `handshake.auth.token` (el JWT es httpOnly, el frontend no puede leerlo para pasarlo explícito).

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
- Socket.io: la cookie httpOnly `session` viaja automática en el handshake (`withCredentials: true` + CORS `credentials: true`), verificada en middleware de conexión antes de permitir join a la room `guild:<id>` — ver detalle en "Fase 5b". No se usa `handshake.auth.token` porque el JWT es httpOnly (el frontend no puede leerlo para pasarlo explícito).
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

## Fase 3b — QueueService (detalle confirmado)

Fase 3b implementa el control real de reproducción: join de voz, play/skip/pause/resume/volumen/remove/shuffle/stop, expuesto por REST y gateado por `requireAuth` + un nuevo middleware `requireGuildAdmin`.

**Corrección post-implementación (Task 3, Fase 3b):** el análisis original de esta sección afirmaba que `player.play(channel, query, options)` existía en tiempo de ejecución pero no estaba declarado en los tipos de discord-player v7.2.0 — un "typings gap". Eso era **incorrecto**: un grep con patrón exacto `"play(channel"` falló en encontrar la declaración real porque el método usa un genérico (`play<T = unknown>(channel: ...)`), no porque falte en `dist/index.d.ts`. `Player.play()` está completamente tipado (línea ~3019 de `dist/index.d.ts`, dentro de la clase `Player`, justo antes de `search()`). El review final de Task 3 encontró y confirmó esto contra el archivo real.

Esto no invalida el código: `queueService.addTrack` igual replica manualmente la secuencia (`player.search` → `player.nodes.create` → `queue.connect` si no conectado → `queue.addTrack` → `queue.node.play()` si no reproduciendo) en vez de llamar al método de conveniencia, lo cual sigue siendo válido — cada paso queda testeable/mockeable por separado sin depender de la caja negra de `player.play()`. Pero la razón correcta es esa (control granular y testabilidad), no un typings gap que nunca existió.

**Archivos:**

```
backend/src/services/queueService.ts
  addTrack(client, player, guildId, userId, query) → Promise<void>
    1. guild.members.fetch(userId) → member.voice.channelId
       → si no está en voz: lanza error tipado (manejado como 400 en la ruta)
    2. player.search(query, { requestedBy: userId })
       → si result.isEmpty(): lanza error tipado (404)
    3. player.nodes.create(guild) → queue
    4. si !queue.channel: await queue.connect(channel) (403 si falla por permisos)
    5. queue.addTrack(result.playlist ?? result.tracks[0])
    6. si !queue.node.isPlaying(): await queue.node.play()
    (no devuelve el track — la ruta reconsulta buildQueueSnapshot(player.nodes.get(guildId)) después, así toda respuesta de la API es un snapshot consistente)
  skip(player, guildId) → boolean          (queue.node.skip())
  pause(player, guildId) → boolean         (queue.node.pause())
  resume(player, guildId) → boolean        (queue.node.resume())
  setVolume(player, guildId, volume) → boolean  (valida 0-100, queue.node.setVolume(volume))
  remove(player, guildId, trackId) → boolean    (queue.removeTrack(trackId))
  shuffle(player, guildId) → boolean       (queue.tracks.shuffle())
  stop(player, guildId) → boolean          (queue.delete())
  Todas (excepto addTrack) devuelven false si player.nodes.get(guildId) es null (sin cola activa) — la ruta lo traduce a 404.

backend/src/http/middleware/requireGuildAdmin.ts
  createRequireGuildAdmin(): RequestHandler → corre después de requireAuth; lee req.params.guildId, chequea que esté en req.user.adminGuildIds (401 si no hay req.user, 403 si no es admin de ese guild)

backend/src/http/routes/queueRoutes.ts (montado en /api/guilds/:guildId/queue, requireAuth + requireGuildAdmin)
  GET    /                → buildQueueSnapshot(player.nodes.get(guildId))
  POST   /                → addTrack (body: { query: string })
  POST   /skip
  POST   /pause
  POST   /resume
  PUT    /volume           → body: { volume: number }
  DELETE /track/:trackId
  POST   /shuffle
  POST   /stop

backend/src/http/routes/guildsRoutes.ts (montado en /api/guilds, requireAuth)
  GET / → req.user.adminGuildIds enriquecido con { id, name } desde client.guilds.cache
```

**Error handling (Fase 3b):**

| Fuente | Manejo |
|---|---|
| Usuario no está en ningún canal de voz al pedir play | 400 `{ message: 'you must be in a voice channel' }` |
| Búsqueda sin resultados | 404 `{ message: 'no results found for query' }` |
| Bot sin permiso Connect/Speak en el canal | 403 `{ message: 'missing voice permissions' }` |
| Acción sobre guild sin cola activa (skip/pause/resume/volume/remove/shuffle/stop) | 404 `{ message: 'no active queue for this guild' }` |
| `volume` fuera de rango 0-100 | 400 validación |
| `guildId` no está en `req.user.adminGuildIds` | 403 (`requireGuildAdmin`) |

**Testing (Fase 3b):**

- `queueService`: usa `Client`/`Player` reales (sin login, mismo patrón que Fases 1-2), pero mockea con `vi.spyOn` los métodos que tocarían red/voz real (`player.search`, `queue.connect`, `queue.node.play`) — verifica orden de llamadas y argumentos, nunca red real.
- `requireGuildAdmin`: unit test con `req.user` fake — admin pasa, no-admin 403, sin `req.user` 401.
- `queueRoutes` / `guildsRoutes`: integración con supertest, `queueService` mockeado vía namespace import (mismo patrón que `authRoutes` en Fase 3a) — no dependen de discord-player real ni de Discord.

## Fase 4 — Slash Commands (detalle confirmado)

Segunda superficie de control además del dashboard REST (Fase 3b), reusando exactamente las mismas funciones de `queueService` — sin lógica duplicada, matching el principio "single source of truth" del diseño original. Sin `requireGuildAdmin`: abierto a cualquiera en el server (Discord ya filtra visibilidad de comandos por permisos de canal/rol si el admin del server lo configura así).

**Env var nueva:** `TEST_GUILD_ID` (solo para el script de deploy de comandos, no para el server principal).

**Archivos:**

```
backend/src/commands/
  types.ts        → Command = { data: SlashCommandBuilder; execute: (interaction, deps) => Promise<void> }
                     CommandDeps = { client: Client; player: Player }
  play.ts         → /play query:string        → queueService.addTrack
  skip.ts         → /skip                     → queueService.skip
  pause.ts        → /pause                    → queueService.pause
  resume.ts       → /resume                   → queueService.resume
  volume.ts       → /volume amount:integer    → queueService.setVolume
  queue.ts        → /queue                    → buildQueueSnapshot(player.nodes.get(guildId)), formateado como texto
  remove.ts       → /remove position:integer  → resuelve position (1-indexed) a trackId vía snapshot, luego queueService.remove
  shuffle.ts      → /shuffle                  → queueService.shuffle
  stop.ts         → /stop                     → queueService.stop
  index.ts        → Collection<string, Command> con los 9 comandos

backend/src/events/interactionCreate.ts
  registerInteractionHandler(client, commands, deps) → client.on('interactionCreate', ...), despacha por interaction.commandName, ignora interacciones no chat-input y comandos desconocidos sin crashear

backend/src/deployCommands.ts
  script standalone (no arranca el bot) → PUT de los 9 comandos al guild TEST_GUILD_ID vía discord.js REST
  nuevo script en package.json: "deploy-commands": "tsx src/deployCommands.ts"
```

**Deferred replies:** `addTrack` puede tardar (search + connect) más de los 3s que Discord da para responder una interacción — todo comando hace `await interaction.deferReply()` primero, `await interaction.editReply(...)` después con el resultado o el error. Respuestas públicas (no efímeras), como la mayoría de bots de música.

**Error handling (Fase 4):**

| Fuente | Reply |
|---|---|
| `NotInVoiceChannelError` (de `addTrack`) | "Tenés que estar en un canal de voz" |
| `NoSearchResultsError` | "No encontré resultados para esa búsqueda" |
| `VoiceConnectionError` | "No tengo permisos para conectarme a ese canal" |
| `InvalidVolumeError` | "El volumen debe estar entre 0 y 100" |
| skip/pause/resume/remove/shuffle/stop devuelve `false` (sin cola activa) | "No hay nada sonando en este server" |
| `/queue` sin cola activa | No es error — muestra estado idle |
| `/remove` con `position` fuera de rango | "Posición inválida" (chequeo antes de llamar a `queueService.remove`) |

**Testing (Fase 4):**

- Cada comando: interaction fake (`deferReply`/`editReply`/`options.getString`/`getInteger` como `vi.fn()`, `guildId`/`user.id` fijos) — mismo patrón de fakes que `queueService`/`queueRoutes`. `queueService` mockeado vía namespace import. Caso éxito + caso error/sin-cola por comando.
- `interactionCreate`: interaction fake con `isChatInputCommand()` true/false, `commandName` conocido/desconocido — despacha al comando correcto, ignora comandos desconocidos e interacciones no-slash sin crashear.
- `deployCommands.ts`: script standalone, sin test automatizado (pega a la API real de Discord) — mismo criterio que `index.ts` en fases anteriores, verificación manual pendiente (necesita bot token real + `TEST_GUILD_ID`).

## Fase 5a — Frontend Scaffolding + Auth (detalle confirmado)

Fase 5 se divide en tres sub-fases independientes: **5a (este addendum)** cubre scaffolding de Vite+React, login, y listado de guilds. **5b** (después) cubre sincronización en tiempo real vía socket.io-client. **5c** (después) cubre los controles de reproducción (play/skip/pause/volumen/etc) conectados a REST.

**Fix de backend pendiente de Fase 3a:** el review final de Fase 3a había encontrado que no había CORS configurado — necesario ahora porque el frontend corre en un origin distinto (`VITE_BACKEND_URL` apuntando a `BACKEND_BASE_URL`). Se agrega acá:

```
backend/src/http/createApp.ts (modificado) → agrega cors({ origin: env.FRONTEND_URL, credentials: true }) antes de las rutas
```

Nueva dep backend: `cors`, `@types/cors`.

**Archivos frontend (workspace nuevo, ya reservado en `pnpm-workspace.yaml` desde Fase 1):**

```
frontend/
  index.html
  vite.config.ts
  vitest.config.ts          → environment: 'jsdom'
  tsconfig.json
  .env.example              → VITE_BACKEND_URL=http://localhost:3001
  src/
    main.tsx                → ReactDOM.render, envuelve App en BrowserRouter + AuthProvider
    App.tsx                 → definición de rutas (react-router-dom)
    context/AuthContext.tsx → AuthProvider + useAuth() hook: { user, adminGuildIds, loading, logout() }
    services/apiClient.ts   → fetchMe(), logout(), fetchGuilds() — fetch con credentials: 'include'
    components/RequireAuth.tsx → wrapper de ruta protegida, redirige a /login si no hay sesión
    pages/LoginPage.tsx        → botón "Login with Discord" (window.location.href a BACKEND_URL/api/auth/login), muestra ?error= si vuelve con falla
    pages/GuildListPage.tsx    → lista guilds vía GET /api/guilds, link a cada uno
    pages/GuildDetailPage.tsx  → placeholder (Fase 5b rellena el contenido real)
    types/index.ts             → tipos compartidos (GuildInfo, SessionUser)
```

**Rutas:** `/login`, `/guilds` (protegida), `/guilds/:guildId` (protegida). Sin librería de UI — CSS plano. `AuthContext` al montar llama `GET /api/auth/me` para saber si ya hay sesión (la cookie la puso el backend en el redirect de OAuth) — no hace falta página de "callback" separada en el frontend.

**Error handling (Fase 5a):**

| Fuente | Manejo |
|---|---|
| `GET /api/auth/me` sin sesión (401) | `AuthContext` pone `user: null`, `RequireAuth` redirige a `/login` |
| `GET /api/guilds` falla | `GuildListPage` muestra mensaje de error |
| Backend redirige a `/login?error=oauth_failed` | `LoginPage` lee query param, muestra mensaje de error |
| Logout | `POST /api/auth/logout` → limpia `AuthContext` → navega a `/login` |

Login en sí no tiene error handling del lado cliente — es navegación completa del browser, no un fetch.

**Testing (Fase 5a):** vitest + `@testing-library/react`, `environment: 'jsdom'`.

- `apiClient`: `fetch` mockeado (`vi.spyOn(global, 'fetch')`) — parseo correcto, maneja status no-ok.
- `AuthContext`: `apiClient.fetchMe` mockeado — popula `user` en éxito, queda `null` en 401.
- `RequireAuth`: con `user: null` redirige a `/login`; con `user` seteado renderiza children.
- `LoginPage`: botón presente, mensaje de error visible cuando la URL trae `?error=`.
- `GuildListPage`: lista de guilds mockeada se renderiza; estado de error visible si `fetchGuilds` falla.

## Fase 5b — Sincronización en tiempo real (detalle confirmado)

Segunda sub-fase del frontend: conecta `GuildDetailPage` al socket.io del backend (Fase 2) para mostrar estado en vivo. Alcance solo lectura — sin botones de control todavía (eso es Fase 5c).

**Decisión de seguridad tomada en esta fase:** el socket.io de Fase 2 no tenía auth (deliberadamente diferido en su momento — "se blinda con JWT sin cambiar la estructura de rooms/eventos"). Ahora que existe frontend real, se cierra ese gap: el handshake de conexión valida la cookie httpOnly `session` (viaja automática si el cliente usa `withCredentials: true` y el servidor tiene CORS con `credentials: true`, ya configurado en Fase 5a), y `guild:join` rechaza guilds fuera de `adminGuildIds` del usuario — mismo patrón que `requireAuth`/`requireGuildAdmin` en REST.

**Archivos:**

```
backend/src/sockets/createSocketServer.ts (modificado)
  → new Server(httpServer, { cors: { origin: frontendUrl, credentials: true } })
  → io.use((socket, next) => { ... }) — parsea cookie 'session' de socket.request.headers.cookie,
    verifySessionToken (mismo de auth/jwt.ts), next(new Error('unauthorized')) si falta/inválida,
    si ok: socket.data.user = { userId, adminGuildIds }
  → guild:join ahora también chequea guildId ∈ socket.data.user.adminGuildIds antes de join()
  → createSocketServer(httpServer, player, jwtSecret, frontendUrl) — firma extendida con los 2 params nuevos

frontend/src/services/socketClient.ts
  → createSocketConnection(): Socket — io(BACKEND_URL, { withCredentials: true })

frontend/src/hooks/useGuildQueue.ts
  → useGuildQueue(guildId: string): { snapshot: QueueSnapshot | null; loading: boolean; error: string | null }
    conecta al montar, emite guild:join, escucha 'queue:state' y 'error'/'connect_error',
    limpia (guild:leave + disconnect) al desmontar o cambiar guildId

frontend/src/pages/GuildDetailPage.tsx (modificado)
  → usa useGuildQueue(guildId), muestra track actual, status, progreso, volumen, cola — solo lectura
```

**Error handling (Fase 5b):**

| Fuente | Manejo |
|---|---|
| Handshake sin cookie `session` válida | Conexión rechazada (`next(new Error('unauthorized'))`), cliente recibe `connect_error` |
| `guild:join` con guildId fuera de `adminGuildIds` | `error` emitido, no hace `join()` |
| `guild:join` sin guildId válido | Igual que Fase 2 (ya existía) |
| Socket sin snapshot todavía | Estado `loading`, no es error |
| `connect_error` / `error` del server | Hook expone estado de error, `GuildDetailPage` muestra mensaje |

**Testing (Fase 5b):**

- `createSocketServer`: conexión con cookie de sesión válida (JWT real firmado con `signSessionToken`) + guildId en `adminGuildIds` → funciona igual que Fase 2; sin cookie → conexión rechazada; guildId fuera de `adminGuildIds` → `error` emitido, sin `queue:state`. `socket.io-client` en Node puede mandar `extraHeaders: { Cookie: ... }` al conectar, sirve para testear el middleware sin necesitar browser real.
- `useGuildQueue`: `io()` mockeado (fake socket con `on`/`emit`/`disconnect` como `vi.fn()`) — simula `queue:state` y verifica que el estado del hook se actualiza; simula `connect_error`/`error` y verifica estado de error.
- `GuildDetailPage`: mockea el hook, renderiza con snapshot fake, verifica que se muestra track/status/cola/volumen.

## Fase 5c — Controles de reproducción (detalle confirmado)

Tercera y última sub-fase del frontend: agrega los controles de reproducción al dashboard, conectados a las rutas REST de `queueRoutes` (Fase 3b). Sin refetch manual tras cada acción — el backend ya emite `queue:state` por socket después de cada mutación (Fase 3b/5b), así que cada botón solo dispara la llamada REST; `useGuildQueue` (ya suscrito) actualiza la UI solo.

**Archivos:**

```
frontend/src/services/apiClient.ts (extendido)
  addTrack(guildId, query): Promise<void>       → POST /api/guilds/:guildId/queue { query }
  skip(guildId): Promise<void>                  → POST .../skip
  pause(guildId): Promise<void>                 → POST .../pause
  resume(guildId): Promise<void>                → POST .../resume
  setVolume(guildId, volume): Promise<void>      → PUT .../volume { volume }
  remove(guildId, trackId): Promise<void>        → DELETE .../track/:trackId
  shuffle(guildId): Promise<void>                → POST .../shuffle
  stop(guildId): Promise<void>                   → POST .../stop
  todas con credentials: 'include', tiran Error con el mensaje del server en respuesta no-ok

frontend/src/pages/GuildDetailPage.tsx (extendido)
  → input + botón Play (siempre visible, deshabilitado si el input está vacío)
  → skip, pause/resume (toggle según snapshot.status), volumen (input + botón),
    remove por track en la lista, shuffle, stop — visibles solo cuando snapshot.currentTrack existe
  → estado local `actionError` (separado del error de conexión del hook), se limpia antes de cada nueva acción
```

**Error handling (Fase 5c):**

| Fuente | Manejo |
|---|---|
| Cualquier acción REST falla (400/403/404/502) | `apiClient` tira `Error` con el mensaje del server; página lo muestra en `actionError` |
| Play con input vacío | Botón deshabilitado, no dispara fetch |
| Volumen fuera de 0-100 | Chequeo del lado cliente antes de mandar (backend igual valida) |
| Nueva acción disparada | Limpia `actionError` anterior antes de la llamada |

**Testing (Fase 5c):**

- `apiClient`: las 8 funciones nuevas, `fetch` mockeado — URL/método/body/credentials correctos, tira en respuesta no-ok.
- `GuildDetailPage`: `apiClient` mockeado (namespace import) + `useGuildQueue` ya mockeado — cada botón dispara la función correcta con los args correctos; error se muestra si la llamada rechaza; controles ocultos si no hay `currentTrack`; toggle pause/resume muestra label correcto según `status`.

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
| 3b | `queueService` real (join voz, play/skip/pause/volumen) + rutas REST de queue (detalle: ver sección "Fase 3b — QueueService") |
| 4 | Slash commands: `/play`, `/skip`, `/pause`, `/resume`, `/queue`, `/volume`, `/remove`, `/shuffle`, `/stop` usando `queueService` (detalle: ver sección "Fase 4 — Slash Commands") |
| 5a | Frontend scaffolding + auth: Vite+React, login, lista de guilds (detalle: ver sección "Fase 5a — Frontend Scaffolding + Auth") |
| 5b | Sincronización en tiempo real: socket.io-client, useGuildQueue, UI de estado en vivo, + auth en el handshake del socket (detalle: ver sección "Fase 5b — Sincronización en tiempo real") |
| 5c | Controles de reproducción: play/skip/pause/volumen/etc conectados a REST (detalle: ver sección "Fase 5c — Controles de reproducción") |
| 6 | Deploy free-tier: Render/Railway (backend+bot), Vercel/Netlify (frontend), consideraciones de sleep/wake-up en free tier |

## Open questions / risks

- Free-tier hosts (Render/Railway free) duermen tras inactividad — reconexión de voz tras cold-start necesita manejo explícito (a resolver en Fase 6).
- Límites de rate-limit de Spotify/SoundCloud vía discord-player extractors no confirmados en producción — validar en Fase 1-2 con uso real.
- CORS: hallazgo del review final de Fase 3a. Rutas Express resueltas en Fase 5a; socket.io resuelto en Fase 5b (junto con el auth del handshake, ver esa sección).
