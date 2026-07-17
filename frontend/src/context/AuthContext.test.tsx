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
