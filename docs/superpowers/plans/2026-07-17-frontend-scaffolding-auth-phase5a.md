# Frontend Scaffolding + Auth (Phase 5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the `frontend/` workspace (Vite + React + TypeScript), a Discord-login flow driven entirely by the backend's existing OAuth2 routes, and a protected guild list — plus the one backend fix (CORS) the frontend needs to actually reach the API. This is the first of three frontend sub-phases; 5b (real-time queue sync) and 5c (playback controls) come later.

**Architecture:** Same factory/dependency-injection spirit as the backend, adapted to React idioms: a small `apiClient` module wraps every backend call, an `AuthContext` holds session state derived from `GET /api/auth/me`, and a `RequireAuth` wrapper gates protected routes. No Redux/Zustand — Context + hooks is enough for this scope. No component library — plain CSS. Routing via `react-router-dom`'s declarative `<Routes>`/`<Route>` (no data-router loaders needed for this scope).

**Tech Stack:** Vite, React 18, TypeScript, `react-router-dom`, `vitest` + `@testing-library/react` + `jsdom` for frontend tests; `cors` added to the backend.

## Global Constraints

- Node.js ≥ 18.17.
- **Backend** stays CommonJS (unchanged constraint from Phase 1). **Frontend** is a separate Vite project and uses standard ESM/bundler TypeScript config (`"module": "ESNext"`, `"moduleResolution": "Bundler"`) — the CommonJS rule never applied to the frontend workspace, only to `backend/` (to avoid discord.js/discord-player CJS interop friction, which doesn't exist here).
- Zero comments in any source code file, frontend included.
- Package manager: pnpm, existing monorepo — `frontend/` workspace already reserved in the root `pnpm-workspace.yaml` since Phase 1.
- Testing: vitest; TDD — failing test before implementation on every task with testable logic. Frontend tests use `@testing-library/react` and never make a real network call — `apiClient` (or the whole module) is mocked via `vi.spyOn`/namespace import, same pattern already established on the backend.
- No placeholder/TODO code.
- **New territory, verify before trusting:** this is the project's first frontend phase, introducing Vite, React, `react-router-dom`, and `@testing-library/react` for the first time. A prior backend phase shipped a design based on a mis-grepped assumption about an external library's types (later corrected). Don't repeat that: if any task's brief references a specific import path, subpath export (e.g. `@testing-library/jest-dom/vitest`), or API shape you're not fully certain still matches the installed package version, check `frontend/node_modules/<package>` directly before writing code that depends on it, and report what you found.
- `apiClient` always sends `credentials: 'include'` on every fetch call, since the backend's session cookie is `httpOnly` and cross-origin.
- Frontend never stores the session token itself — it only ever asks the backend "am I logged in" via `GET /api/auth/me` and trusts the httpOnly cookie to carry the actual session.

---

### Task 1: Backend CORS fix

**Files:**
- Modify: `backend/package.json` (add `cors` dependency, `@types/cors` dev dependency)
- Modify: `backend/src/http/createApp.ts`
- Modify: `backend/src/http/createApp.test.ts`

**Interfaces:**
- Consumes: `AuthRoutesConfig.frontendUrl` (already exists, Phase 3a).
- Produces: `createApp` now sends `Access-Control-Allow-Origin`/`Access-Control-Allow-Credentials` headers for requests from the configured frontend origin. No later task in this plan depends on this file, but every frontend task's manual-verification step assumes it's in place.

- [ ] **Step 1: Add the `cors` dependency**

Edit `backend/package.json`: add to `"dependencies"`:

```json
    "cors": "^2.8.5",
```

and to `"devDependencies"`:

```json
    "@types/cors": "^2.8.17",
```

Run: `pnpm install`
Expected: install completes, `cors` appears in `backend/node_modules`.

- [ ] **Step 2: Write the failing test**

Add to `backend/src/http/createApp.test.ts` (keep the existing test, add this one):

```ts
  it('sets CORS headers for the configured frontend origin', async () => {
    const client = createDiscordClient();
    const player = await createPlayer(client);
    const app = createApp(testAuthConfig, client, player);

    const response = await request(app).get('/health').set('Origin', testAuthConfig.frontendUrl);

    expect(response.headers['access-control-allow-origin']).toBe(testAuthConfig.frontendUrl);
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter backend test -- createApp.test.ts`
Expected: FAIL — no CORS headers present yet.

- [ ] **Step 3: Write the implementation**

`backend/src/http/createApp.ts`:

```ts
import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import type { Client } from 'discord.js';
import type { Player } from 'discord-player';
import { createAuthRoutes, AuthRoutesConfig } from './routes/authRoutes';
import { createGuildsRoutes } from './routes/guildsRoutes';
import { createQueueRoutes } from './routes/queueRoutes';

export function createApp(authRoutesConfig: AuthRoutesConfig, client: Client, player: Player): Express {
  const app = express();
  app.use(cors({ origin: authRoutesConfig.frontendUrl, credentials: true }));
  app.use(cookieParser());
  app.use(express.json());

  app.get('/health', (_req, res) => {
    res.status(200).json({ status: 'ok' });
  });

  app.use('/api/auth', createAuthRoutes(authRoutesConfig));

  app.use(
    '/api/guilds',
    createGuildsRoutes({
      jwtSecret: authRoutesConfig.jwtSecret,
      getGuildInfo: (guildIds) =>
        guildIds.map((id) => ({ id, name: client.guilds.cache.get(id)?.name ?? 'Unknown guild' })),
    }),
  );

  app.use(
    '/api/guilds/:guildId/queue',
    createQueueRoutes({ jwtSecret: authRoutesConfig.jwtSecret, client, player }),
  );

  return app;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- createApp.test.ts`
Expected: PASS, 2 tests.

Run: `pnpm --filter backend test`
Expected: PASS, all 133 tests (132 carried over from Phases 1-4 + 1 new CORS test).

- [ ] **Step 5: Commit**

```bash
git add backend/package.json pnpm-lock.yaml backend/src/http/createApp.ts backend/src/http/createApp.test.ts
git commit -m "feat: add CORS support for the frontend origin"
```

Note: `pnpm install` updates the workspace-root `pnpm-lock.yaml` — run `git status` to confirm the exact changed path before staging.

---

### Task 2: Frontend workspace scaffolding

**Files:**
- Create: `frontend/package.json`
- Create: `frontend/vite.config.ts`
- Create: `frontend/vitest.config.ts`
- Create: `frontend/vitest.setup.ts`
- Create: `frontend/tsconfig.json`
- Create: `frontend/tsconfig.node.json`
- Create: `frontend/.env.example`
- Create: `frontend/.gitignore`
- Create: `frontend/index.html`
- Create: `frontend/src/main.tsx` (placeholder)
- Create: `frontend/src/App.tsx` (placeholder)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: a working `pnpm --filter frontend dev` command (Vite dev server) and a working `pnpm --filter frontend test` command (`vitest run` with jsdom). Every later task in this plan builds inside `frontend/src/`.

- [ ] **Step 1: Create the backend-style project files**

`frontend/package.json`:

```json
{
  "name": "frontend",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "preview": "vite preview",
    "test": "vitest run"
  },
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "react-router-dom": "^6.28.0"
  },
  "devDependencies": {
    "@testing-library/jest-dom": "^6.6.3",
    "@testing-library/react": "^16.0.1",
    "@testing-library/user-event": "^14.5.2",
    "@types/react": "^18.3.12",
    "@types/react-dom": "^18.3.1",
    "@vitejs/plugin-react": "^4.3.4",
    "jsdom": "^25.0.1",
    "typescript": "^5.6.3",
    "vite": "^5.4.11",
    "vitest": "^2.1.4"
  }
}
```

`frontend/vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
});
```

`frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
  },
});
```

`frontend/vitest.setup.ts`:

```ts
import '@testing-library/jest-dom/vitest';
```

If this exact subpath import doesn't resolve against the installed `@testing-library/jest-dom` version, check `frontend/node_modules/@testing-library/jest-dom/package.json`'s `exports` field for the correct entry point before falling back to a plain `import '@testing-library/jest-dom';`.

`frontend/tsconfig.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "jsx": "react-jsx",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "noEmit": true
  },
  "include": ["src"],
  "references": [{ "path": "./tsconfig.node.json" }]
}
```

`frontend/tsconfig.node.json`:

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "allowSyntheticDefaultImports": true,
    "strict": true,
    "noEmit": true
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

`frontend/.env.example`:

```
VITE_BACKEND_URL=http://localhost:3001
```

`frontend/.gitignore`:

```
node_modules
dist
.env
.env.*
!.env.example
```

`frontend/index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Discord Music Dashboard</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.tsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create placeholder entry files**

`frontend/src/App.tsx`:

```tsx
export function App() {
  return <p>frontend toolchain ready</p>;
}
```

`frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
```

- [ ] **Step 3: Install dependencies and verify the toolchain**

Run: `pnpm install`
Expected: install completes with no errors, `frontend/node_modules` created.

Run: `pnpm --filter frontend dev`
Expected: Vite prints a local dev server URL (default `http://localhost:5173`); visiting it in a browser would show "frontend toolchain ready" (not verifiable in this environment without a browser — the console output starting cleanly is the automatable signal). Stop with Ctrl+C.

Run: `pnpm --filter frontend test`
Expected: vitest runs, reports "No test files found" (exit code 1) — expected and matches the same pattern from Phase 1's backend scaffolding: the next task adds the first real test file.

- [ ] **Step 4: Commit**

```bash
git add frontend/package.json frontend/vite.config.ts frontend/vitest.config.ts frontend/vitest.setup.ts frontend/tsconfig.json frontend/tsconfig.node.json frontend/.env.example frontend/.gitignore frontend/index.html frontend/src/main.tsx frontend/src/App.tsx
git commit -m "chore: scaffold frontend Vite + React + TypeScript toolchain"
```

---

### Task 3: `types/index.ts` + `services/apiClient.ts`

**Files:**
- Create: `frontend/src/types/index.ts`
- Create: `frontend/src/services/apiClient.ts`
- Test: `frontend/src/services/apiClient.test.ts`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `SessionUser` type (`{ userId: string; adminGuildIds: string[] }`), `GuildInfo` type (`{ id: string; name: string }`), `UnauthorizedError` class, `fetchMe(): Promise<SessionUser>`, `logout(): Promise<void>`, `fetchGuilds(): Promise<GuildInfo[]>`, `getLoginUrl(): string`. Task 4 (`AuthContext`) imports `fetchMe`/`logout`/`UnauthorizedError`/`SessionUser`; Task 6 (`LoginPage`) imports `getLoginUrl`; Task 7 (`GuildListPage`) imports `fetchGuilds`/`GuildInfo`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/services/apiClient.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import { fetchMe, logout, fetchGuilds, getLoginUrl, UnauthorizedError } from './apiClient';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as Response;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('fetchMe', () => {
  it('returns the session user on success', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      jsonResponse(200, { userId: 'user-1', adminGuildIds: ['guild-1'] }),
    );

    const result = await fetchMe();

    expect(result).toEqual({ userId: 'user-1', adminGuildIds: ['guild-1'] });
    const [url, init] = (global.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain('/api/auth/me');
    expect(init?.credentials).toBe('include');
  });

  it('throws UnauthorizedError on a 401', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(401, {}));

    await expect(fetchMe()).rejects.toThrow(UnauthorizedError);
  });
});

describe('logout', () => {
  it('posts to the logout endpoint with credentials included', async () => {
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, {}));

    await logout();

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toContain('/api/auth/logout');
    expect(init?.method).toBe('POST');
    expect(init?.credentials).toBe('include');
  });
});

describe('fetchGuilds', () => {
  it('returns the guild list on success', async () => {
    const guilds = [{ id: 'guild-1', name: 'My Server' }];
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(200, guilds));

    const result = await fetchGuilds();

    expect(result).toEqual(guilds);
  });

  it('throws when the response is not ok', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(jsonResponse(500, {}));

    await expect(fetchGuilds()).rejects.toThrow();
  });
});

describe('getLoginUrl', () => {
  it('returns a URL pointing at the backend login route', () => {
    expect(getLoginUrl()).toContain('/api/auth/login');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- apiClient.test.ts`
Expected: FAIL with "Cannot find module './apiClient'".

- [ ] **Step 3: Write the implementation**

`frontend/src/types/index.ts`:

```ts
export type SessionUser = {
  userId: string;
  adminGuildIds: string[];
};

export type GuildInfo = {
  id: string;
  name: string;
};
```

`frontend/src/services/apiClient.ts`:

```ts
import type { SessionUser, GuildInfo } from '../types';

const BACKEND_URL = (import.meta.env.VITE_BACKEND_URL as string | undefined) ?? 'http://localhost:3001';

export class UnauthorizedError extends Error {
  constructor() {
    super('unauthorized');
  }
}

export async function fetchMe(): Promise<SessionUser> {
  const response = await fetch(`${BACKEND_URL}/api/auth/me`, { credentials: 'include' });

  if (response.status === 401) {
    throw new UnauthorizedError();
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch session: ${response.status}`);
  }

  return (await response.json()) as SessionUser;
}

export async function logout(): Promise<void> {
  const response = await fetch(`${BACKEND_URL}/api/auth/logout`, {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error(`Failed to log out: ${response.status}`);
  }
}

export async function fetchGuilds(): Promise<GuildInfo[]> {
  const response = await fetch(`${BACKEND_URL}/api/guilds`, { credentials: 'include' });

  if (!response.ok) {
    throw new Error(`Failed to fetch guilds: ${response.status}`);
  }

  return (await response.json()) as GuildInfo[];
}

export function getLoginUrl(): string {
  return `${BACKEND_URL}/api/auth/login`;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- apiClient.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/types/index.ts frontend/src/services/apiClient.ts frontend/src/services/apiClient.test.ts
git commit -m "feat: add shared types and apiClient"
```

---

### Task 4: `context/AuthContext.tsx`

**Files:**
- Create: `frontend/src/context/AuthContext.tsx`
- Test: `frontend/src/context/AuthContext.test.tsx`

**Interfaces:**
- Consumes: `fetchMe`, `logout`, `UnauthorizedError`, `SessionUser` (Task 3).
- Produces: `AuthContext` (React context, exported for test wrapping), `AuthProvider({ children }): JSX.Element`, `useAuth(): { user: SessionUser | null; loading: boolean; logout: () => Promise<void> }`. Task 5 (`RequireAuth`) imports `AuthContext`/`useAuth`; Task 8 (`main.tsx`) wraps the app in `AuthProvider`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/context/AuthContext.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import * as apiClient from '../services/apiClient';
import { AuthProvider, useAuth } from './AuthContext';

function TestConsumer() {
  const { user, loading } = useAuth();

  if (loading) return <p>loading</p>;
  if (!user) return <p>no user</p>;
  return <p>{user.userId}</p>;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('AuthProvider', () => {
  it('populates the user after fetchMe resolves', async () => {
    vi.spyOn(apiClient, 'fetchMe').mockResolvedValue({ userId: 'user-1', adminGuildIds: [] });

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    expect(screen.getByText('loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('user-1')).toBeInTheDocument());
  });

  it('keeps user null when fetchMe rejects', async () => {
    vi.spyOn(apiClient, 'fetchMe').mockRejectedValue(new apiClient.UnauthorizedError());

    render(
      <AuthProvider>
        <TestConsumer />
      </AuthProvider>,
    );

    await waitFor(() => expect(screen.getByText('no user')).toBeInTheDocument());
  });
});
```

Note: this test mocks `apiClient.fetchMe` via `vi.spyOn`, requiring `AuthContext.tsx` to import `apiClient` as a namespace (`import * as apiClient from '../services/apiClient'`), same pattern as the backend's `authRoutes.ts`/`queueRoutes.ts`.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- AuthContext.test.tsx`
Expected: FAIL with "Cannot find module './AuthContext'".

- [ ] **Step 3: Write the implementation**

`frontend/src/context/AuthContext.tsx`:

```tsx
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import * as apiClient from '../services/apiClient';
import type { SessionUser } from '../types';

type AuthContextValue = {
  user: SessionUser | null;
  loading: boolean;
  logout: () => Promise<void>;
};

export const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SessionUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .fetchMe()
      .then((sessionUser) => setUser(sessionUser))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, []);

  async function logout(): Promise<void> {
    await apiClient.logout();
    setUser(null);
  }

  return <AuthContext.Provider value={{ user, loading, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }

  return context;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- AuthContext.test.tsx`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/context/AuthContext.tsx frontend/src/context/AuthContext.test.tsx
git commit -m "feat: add AuthContext with session bootstrapping via fetchMe"
```

---

### Task 5: `components/RequireAuth.tsx`

**Files:**
- Create: `frontend/src/components/RequireAuth.tsx`
- Test: `frontend/src/components/RequireAuth.test.tsx`

**Interfaces:**
- Consumes: `AuthContext` (Task 4).
- Produces: `RequireAuth({ children }): JSX.Element`. Task 8 (`App.tsx`) wraps the `/guilds` and `/guilds/:guildId` route elements in `RequireAuth`.

- [ ] **Step 1: Write the failing tests**

`frontend/src/components/RequireAuth.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { AuthContext } from '../context/AuthContext';
import { RequireAuth } from './RequireAuth';

function renderWithAuth(authValue: { user: { userId: string; adminGuildIds: string[] } | null; loading: boolean }) {
  return render(
    <AuthContext.Provider value={{ ...authValue, logout: async () => undefined }}>
      <MemoryRouter initialEntries={['/guilds']}>
        <Routes>
          <Route path="/login" element={<p>login page</p>} />
          <Route
            path="/guilds"
            element={
              <RequireAuth>
                <p>protected content</p>
              </RequireAuth>
            }
          />
        </Routes>
      </MemoryRouter>
    </AuthContext.Provider>,
  );
}

describe('RequireAuth', () => {
  it('shows a loading state while the session check is in flight', () => {
    renderWithAuth({ user: null, loading: true });

    expect(screen.queryByText('protected content')).not.toBeInTheDocument();
    expect(screen.queryByText('login page')).not.toBeInTheDocument();
  });

  it('redirects to /login when there is no user', () => {
    renderWithAuth({ user: null, loading: false });

    expect(screen.getByText('login page')).toBeInTheDocument();
  });

  it('renders the protected content when a user is present', () => {
    renderWithAuth({ user: { userId: 'user-1', adminGuildIds: [] }, loading: false });

    expect(screen.getByText('protected content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- RequireAuth.test.tsx`
Expected: FAIL with "Cannot find module './RequireAuth'".

- [ ] **Step 3: Write the implementation**

`frontend/src/components/RequireAuth.tsx`:

```tsx
import { Navigate } from 'react-router-dom';
import { ReactNode } from 'react';
import { useAuth } from '../context/AuthContext';

export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();

  if (loading) {
    return <p>Loading...</p>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- RequireAuth.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/RequireAuth.tsx frontend/src/components/RequireAuth.test.tsx
git commit -m "feat: add RequireAuth route guard"
```

---

### Task 6: `pages/LoginPage.tsx`

**Files:**
- Create: `frontend/src/pages/LoginPage.tsx`
- Test: `frontend/src/pages/LoginPage.test.tsx`

**Interfaces:**
- Consumes: `getLoginUrl` (Task 3).
- Produces: `LoginPage(): JSX.Element`. Task 8 (`App.tsx`) routes `/login` to this component.

- [ ] **Step 1: Write the failing tests**

`frontend/src/pages/LoginPage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LoginPage } from './LoginPage';

describe('LoginPage', () => {
  it('shows a login link pointing at the backend login route', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    );

    const link = screen.getByRole('link', { name: /login with discord/i });
    expect(link).toHaveAttribute('href', expect.stringContaining('/api/auth/login'));
  });

  it('does not show an error message with no error query param', () => {
    render(
      <MemoryRouter initialEntries={['/login']}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('shows an error message when the URL has an error query param', () => {
    render(
      <MemoryRouter initialEntries={['/login?error=oauth_failed']}>
        <LoginPage />
      </MemoryRouter>,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- LoginPage.test.tsx`
Expected: FAIL with "Cannot find module './LoginPage'".

- [ ] **Step 3: Write the implementation**

`frontend/src/pages/LoginPage.tsx`:

```tsx
import { useSearchParams } from 'react-router-dom';
import { getLoginUrl } from '../services/apiClient';

export function LoginPage() {
  const [searchParams] = useSearchParams();
  const error = searchParams.get('error');

  return (
    <div>
      <h1>Discord Music Dashboard</h1>
      {error ? <p role="alert">Login failed. Please try again.</p> : null}
      <a href={getLoginUrl()}>Login with Discord</a>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- LoginPage.test.tsx`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/LoginPage.tsx frontend/src/pages/LoginPage.test.tsx
git commit -m "feat: add LoginPage"
```

---

### Task 7: `pages/GuildListPage.tsx` + `pages/GuildDetailPage.tsx`

**Files:**
- Create: `frontend/src/pages/GuildListPage.tsx`
- Create: `frontend/src/pages/GuildListPage.test.tsx`
- Create: `frontend/src/pages/GuildDetailPage.tsx`
- Create: `frontend/src/pages/GuildDetailPage.test.tsx`

**Interfaces:**
- Consumes: `fetchGuilds`, `GuildInfo` (Task 3).
- Produces: `GuildListPage(): JSX.Element`, `GuildDetailPage(): JSX.Element`. Task 8 (`App.tsx`) routes `/guilds` to `GuildListPage` and `/guilds/:guildId` to `GuildDetailPage`. `GuildDetailPage` is a placeholder — Phase 5b replaces its body with the real-time queue view.

- [ ] **Step 1: Write the failing tests**

`frontend/src/pages/GuildListPage.test.tsx`:

```tsx
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import * as apiClient from '../services/apiClient';
import { GuildListPage } from './GuildListPage';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('GuildListPage', () => {
  it('renders a link for each guild once loaded', async () => {
    vi.spyOn(apiClient, 'fetchGuilds').mockResolvedValue([
      { id: 'guild-1', name: 'My Server' },
    ]);

    render(
      <MemoryRouter>
        <GuildListPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('link', { name: 'My Server' })).toBeInTheDocument());
    expect(screen.getByRole('link', { name: 'My Server' })).toHaveAttribute('href', '/guilds/guild-1');
  });

  it('shows an error message when fetchGuilds fails', async () => {
    vi.spyOn(apiClient, 'fetchGuilds').mockRejectedValue(new Error('boom'));

    render(
      <MemoryRouter>
        <GuildListPage />
      </MemoryRouter>,
    );

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
```

`frontend/src/pages/GuildDetailPage.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GuildDetailPage } from './GuildDetailPage';

describe('GuildDetailPage', () => {
  it('shows the guild id from the URL', () => {
    render(
      <MemoryRouter initialEntries={['/guilds/guild-1']}>
        <Routes>
          <Route path="/guilds/:guildId" element={<GuildDetailPage />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText(/guild-1/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter frontend test -- GuildListPage.test.tsx GuildDetailPage.test.tsx`
Expected: FAIL with "Cannot find module" for both.

- [ ] **Step 3: Write the implementation**

`frontend/src/pages/GuildListPage.tsx`:

```tsx
import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import * as apiClient from '../services/apiClient';
import type { GuildInfo } from '../types';

export function GuildListPage() {
  const [guilds, setGuilds] = useState<GuildInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiClient
      .fetchGuilds()
      .then((result) => setGuilds(result))
      .catch(() => setError('Failed to load your servers.'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p>Loading...</p>;
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  return (
    <ul>
      {guilds.map((guild) => (
        <li key={guild.id}>
          <Link to={`/guilds/${guild.id}`}>{guild.name}</Link>
        </li>
      ))}
    </ul>
  );
}
```

`frontend/src/pages/GuildDetailPage.tsx`:

```tsx
import { useParams } from 'react-router-dom';

export function GuildDetailPage() {
  const { guildId } = useParams<{ guildId: string }>();

  return <p>Queue view for guild {guildId} coming in Phase 5b.</p>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter frontend test -- GuildListPage.test.tsx GuildDetailPage.test.tsx`
Expected: PASS, 3 tests (2 + 1).

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/GuildListPage.tsx frontend/src/pages/GuildListPage.test.tsx frontend/src/pages/GuildDetailPage.tsx frontend/src/pages/GuildDetailPage.test.tsx
git commit -m "feat: add GuildListPage and GuildDetailPage placeholder"
```

---

### Task 8: Wire `App.tsx` + `main.tsx`

**Files:**
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/main.tsx`

**Interfaces:**
- Consumes: `LoginPage` (Task 6), `GuildListPage`/`GuildDetailPage` (Task 7), `RequireAuth` (Task 5), `AuthProvider` (Task 4).
- Produces: the running frontend app. No further tasks in this plan consume these files. This file has no dedicated test — same precedent as the backend's `index.ts` (thin composition root, each piece already tested individually).

- [ ] **Step 1: Replace `App.tsx`**

`frontend/src/App.tsx`:

```tsx
import { Routes, Route, Navigate } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { GuildListPage } from './pages/GuildListPage';
import { GuildDetailPage } from './pages/GuildDetailPage';
import { RequireAuth } from './components/RequireAuth';

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/guilds"
        element={
          <RequireAuth>
            <GuildListPage />
          </RequireAuth>
        }
      />
      <Route
        path="/guilds/:guildId"
        element={
          <RequireAuth>
            <GuildDetailPage />
          </RequireAuth>
        }
      />
      <Route path="*" element={<Navigate to="/guilds" replace />} />
    </Routes>
  );
}
```

- [ ] **Step 2: Replace `main.tsx`**

`frontend/src/main.tsx`:

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { AuthProvider } from './context/AuthContext';
import { App } from './App';

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <App />
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
);
```

- [ ] **Step 3: Run the full frontend test suite to confirm nothing broke**

Run: `pnpm --filter frontend test`
Expected: PASS, all 17 tests (6 apiClient + 2 AuthContext + 3 RequireAuth + 3 LoginPage + 3 GuildListPage/GuildDetailPage — this file has no tests of its own).

- [ ] **Step 4: Build verification**

Run: `pnpm --filter frontend build`
Expected: `tsc -b && vite build` completes with no type errors, producing a `frontend/dist/` bundle. This is the closest automatable proxy for "the app actually works" without a real browser.

- [ ] **Step 5: Manual verification**

No browser is available in this development environment, so end-to-end verification (actually clicking "Login with Discord", completing the OAuth flow, seeing the guild list) is a pending manual step for the user:

1. Copy `frontend/.env.example` to `frontend/.env` (default `VITE_BACKEND_URL=http://localhost:3001` is fine for local dev).
2. Run the backend (`pnpm --filter backend dev`) with real credentials filled in, and the frontend (`pnpm --filter frontend dev`) in parallel.
3. Visit `http://localhost:5173/guilds` in a browser — expect a redirect to `/login` (no session yet).
4. Click "Login with Discord", complete the Discord consent screen — expect a redirect back to `http://localhost:5173` with a `session` cookie set, and the guild list showing the servers you administer where the bot is present.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/App.tsx frontend/src/main.tsx
git commit -m "feat: wire routes, AuthProvider, and BrowserRouter in the app entry point"
```
