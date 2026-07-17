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
