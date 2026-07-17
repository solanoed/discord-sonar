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
