import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import * as useGuildQueueModule from '../hooks/useGuildQueue';
import { GuildDetailPage } from './GuildDetailPage';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/guilds/guild-1']}>
      <Routes>
        <Route path="/guilds/:guildId" element={<GuildDetailPage />} />
      </Routes>
    </MemoryRouter>,
  );
}

describe('GuildDetailPage', () => {
  it('shows a loading state', () => {
    vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({ snapshot: null, loading: true, error: null });

    renderPage();

    expect(screen.getByText('Loading...')).toBeInTheDocument();
  });

  it('shows an error message', () => {
    vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({
      snapshot: null,
      loading: false,
      error: 'you do not have access to this guild',
    });

    renderPage();

    expect(screen.getByRole('alert')).toHaveTextContent('you do not have access to this guild');
  });

  it('shows an idle message when nothing is playing', () => {
    vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({
      snapshot: { status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 },
      loading: false,
      error: null,
    });

    renderPage();

    expect(screen.getByText('Nothing is playing in this server.')).toBeInTheDocument();
  });

  it('shows the current track, status, volume, and queue', () => {
    vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({
      snapshot: {
        status: 'playing',
        currentTrack: {
          id: 't1',
          title: 'Now Playing',
          author: 'Artist',
          url: 'u',
          thumbnail: 't',
          durationMs: 1000,
        },
        queue: [{ id: 't2', title: 'Up Next', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 }],
        volume: 80,
        progressMs: 0,
      },
      loading: false,
      error: null,
    });

    renderPage();

    expect(screen.getByText('Now Playing')).toBeInTheDocument();
    expect(screen.getByText('Artist')).toBeInTheDocument();
    expect(screen.getByText(/playing/)).toBeInTheDocument();
    expect(screen.getByText(/80/)).toBeInTheDocument();
    expect(screen.getByText(/Up Next/)).toBeInTheDocument();
  });
});
