import { useParams } from 'react-router-dom';

export function GuildDetailPage() {
  const { guildId } = useParams<{ guildId: string }>();

  return <p>Queue view for guild {guildId} coming in Phase 5b.</p>;
}
