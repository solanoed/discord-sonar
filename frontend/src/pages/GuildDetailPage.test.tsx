import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import * as useGuildQueueModule from '../hooks/useGuildQueue';
import * as apiClient from '../services/apiClient';
import type { QueueSnapshot } from '../types';
import { GuildDetailPage } from './GuildDetailPage';

afterEach(() => {
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

function playingSnapshot(overrides: Partial<QueueSnapshot> = {}): QueueSnapshot {
  return {
    status: 'playing',
    currentTrack: { id: 't1', title: 'Now Playing', author: 'Artist', url: 'u', thumbnail: 't', durationMs: 1000 },
    queue: [{ id: 't2', title: 'Up Next', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 }],
    volume: 80,
    progressMs: 0,
    ...overrides,
  };
}

function mockQueue(snapshot: QueueSnapshot | null) {
  vi.spyOn(useGuildQueueModule, 'useGuildQueue').mockReturnValue({ snapshot, loading: false, error: null });
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

describe('GuildDetailPage playback controls', () => {
  it('submits the play form and calls addTrack with the guild id, query, and default source', async () => {
    mockQueue(null);
    vi.spyOn(apiClient, 'addTrack').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByPlaceholderText('Song name or URL'), 'never gonna give you up');
    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(apiClient.addTrack).toHaveBeenCalledWith('guild-1', 'never gonna give you up', 'youtube');
  });

  it('submits the play form with soundcloud when that source is selected', async () => {
    mockQueue(null);
    vi.spyOn(apiClient, 'addTrack').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByPlaceholderText('Song name or URL'), 'a song');
    await user.selectOptions(screen.getByRole('combobox'), 'soundcloud');
    await user.click(screen.getByRole('button', { name: 'Play' }));

    expect(apiClient.addTrack).toHaveBeenCalledWith('guild-1', 'a song', 'soundcloud');
  });

  it('disables the play button when the input is empty', () => {
    mockQueue(null);
    renderPage();

    expect(screen.getByRole('button', { name: 'Play' })).toBeDisabled();
  });

  it('hides playback controls when nothing is playing', () => {
    mockQueue({ status: 'idle', currentTrack: null, queue: [], volume: 100, progressMs: 0 });
    renderPage();

    expect(screen.queryByRole('button', { name: 'Skip' })).not.toBeInTheDocument();
  });

  it('calls skip when the skip button is clicked', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'skip').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(apiClient.skip).toHaveBeenCalledWith('guild-1');
  });

  it('shows a Pause button and calls pause when the status is playing', async () => {
    mockQueue(playingSnapshot({ status: 'playing' }));
    vi.spyOn(apiClient, 'pause').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Pause' }));

    expect(apiClient.pause).toHaveBeenCalledWith('guild-1');
  });

  it('shows a Resume button and calls resume when the status is paused', async () => {
    mockQueue(playingSnapshot({ status: 'paused' }));
    vi.spyOn(apiClient, 'resume').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Resume' }));

    expect(apiClient.resume).toHaveBeenCalledWith('guild-1');
  });

  it('calls stop when the stop button is clicked', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'stop').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Stop' }));

    expect(apiClient.stop).toHaveBeenCalledWith('guild-1');
  });

  it('calls shuffle when the shuffle button is clicked', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'shuffle').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Shuffle' }));

    expect(apiClient.shuffle).toHaveBeenCalledWith('guild-1');
  });

  it('submits the volume form and calls setVolume with the parsed number', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'setVolume').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByPlaceholderText('0-100'), '50');
    await user.click(screen.getByRole('button', { name: 'Set volume' }));

    expect(apiClient.setVolume).toHaveBeenCalledWith('guild-1', 50);
  });

  it('does not call setVolume when the volume input is out of range', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'setVolume').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.type(screen.getByPlaceholderText('0-100'), '500');
    await user.click(screen.getByRole('button', { name: 'Set volume' }));

    expect(apiClient.setVolume).not.toHaveBeenCalled();
  });

  it('does not call setVolume when the volume input is empty', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'setVolume').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Set volume' }));

    expect(apiClient.setVolume).not.toHaveBeenCalled();
  });

  it('calls remove with the guild id and track id when a remove button is clicked', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'remove').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Remove' }));

    expect(apiClient.remove).toHaveBeenCalledWith('guild-1', 't2');
  });

  it('shows an action error when a control call rejects', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'skip').mockRejectedValue(new Error('no active queue for this guild'));
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Skip' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('no active queue for this guild');
  });

  it('clears a previous action error when a new action is triggered', async () => {
    mockQueue(playingSnapshot());
    vi.spyOn(apiClient, 'skip').mockRejectedValueOnce(new Error('no active queue for this guild'));
    vi.spyOn(apiClient, 'shuffle').mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderPage();
    await user.click(screen.getByRole('button', { name: 'Skip' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('no active queue for this guild');

    await user.click(screen.getByRole('button', { name: 'Shuffle' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
