import { useParams } from 'react-router-dom';
import { FormEvent, useState } from 'react';
import * as useGuildQueueModule from '../hooks/useGuildQueue';
import * as apiClient from '../services/apiClient';
import type { TrackSource } from '../services/apiClient';

export function GuildDetailPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { snapshot, loading, error } = useGuildQueueModule.useGuildQueue(guildId ?? '');
  const [query, setQuery] = useState('');
  const [source, setSource] = useState<TrackSource>('youtube');
  const [volumeInput, setVolumeInput] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);

  async function runAction(action: () => Promise<void>): Promise<void> {
    setActionError(null);
    try {
      await action();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  }

  function handlePlaySubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!guildId || query.trim().length === 0) {
      return;
    }
    const submittedQuery = query;
    setQuery('');
    void runAction(() => apiClient.addTrack(guildId, submittedQuery, source));
  }

  function handleVolumeSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const amount = Number(volumeInput);
    if (!guildId || volumeInput.trim().length === 0 || !Number.isFinite(amount) || amount < 0 || amount > 100) {
      return;
    }
    void runAction(() => apiClient.setVolume(guildId, amount));
  }

  if (loading) {
    return <p>Loading...</p>;
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  return (
    <div>
      {actionError ? <p role="alert">{actionError}</p> : null}

      <form onSubmit={handlePlaySubmit}>
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Song name or URL"
        />
        <select value={source} onChange={(event) => setSource(event.target.value as TrackSource)}>
          <option value="youtube">YouTube</option>
          <option value="soundcloud">SoundCloud</option>
        </select>
        <button type="submit" disabled={query.trim().length === 0}>
          Play
        </button>
      </form>

      {!snapshot || !snapshot.currentTrack ? (
        <p>Nothing is playing in this server.</p>
      ) : (
        <div>
          <h2>{snapshot.currentTrack.title}</h2>
          <p>{snapshot.currentTrack.author}</p>
          <p>Status: {snapshot.status}</p>
          <p>Volume: {snapshot.volume}</p>

          <button onClick={() => guildId && void runAction(() => apiClient.skip(guildId))}>Skip</button>
          {snapshot.status === 'paused' ? (
            <button onClick={() => guildId && void runAction(() => apiClient.resume(guildId))}>Resume</button>
          ) : (
            <button onClick={() => guildId && void runAction(() => apiClient.pause(guildId))}>Pause</button>
          )}
          <button onClick={() => guildId && void runAction(() => apiClient.shuffle(guildId))}>Shuffle</button>
          <button onClick={() => guildId && void runAction(() => apiClient.stop(guildId))}>Stop</button>

          <form onSubmit={handleVolumeSubmit}>
            <input
              value={volumeInput}
              onChange={(event) => setVolumeInput(event.target.value)}
              placeholder="0-100"
            />
            <button type="submit">Set volume</button>
          </form>

          <ul>
            {snapshot.queue.map((track, index) => (
              <li key={track.id}>
                {index + 1}. {track.title}
                <button
                  onClick={() => guildId && void runAction(() => apiClient.remove(guildId, track.id))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
