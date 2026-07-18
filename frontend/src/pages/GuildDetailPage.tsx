import { useParams } from 'react-router-dom';
import * as useGuildQueueModule from '../hooks/useGuildQueue';

export function GuildDetailPage() {
  const { guildId } = useParams<{ guildId: string }>();
  const { snapshot, loading, error } = useGuildQueueModule.useGuildQueue(guildId ?? '');

  if (loading) {
    return <p>Loading...</p>;
  }

  if (error) {
    return <p role="alert">{error}</p>;
  }

  if (!snapshot || !snapshot.currentTrack) {
    return <p>Nothing is playing in this server.</p>;
  }

  return (
    <div>
      <h2>{snapshot.currentTrack.title}</h2>
      <p>{snapshot.currentTrack.author}</p>
      <p>Status: {snapshot.status}</p>
      <p>Volume: {snapshot.volume}</p>
      <ul>
        {snapshot.queue.map((track, index) => (
          <li key={track.id}>
            {index + 1}. {track.title}
          </li>
        ))}
      </ul>
    </div>
  );
}
