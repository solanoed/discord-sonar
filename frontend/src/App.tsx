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
