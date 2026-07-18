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

  it('shows an empty-state message when there are no mutual admin guilds', async () => {
    vi.spyOn(apiClient, 'fetchGuilds').mockResolvedValue([]);

    render(
      <MemoryRouter>
        <GuildListPage />
      </MemoryRouter>,
    );

    await waitFor(() =>
      expect(
        screen.getByText(/no servers|invite the bot|no admin/i),
      ).toBeInTheDocument(),
    );
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
