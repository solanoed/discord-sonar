import type { GuildQueue, Track } from 'discord-player';

export type QueueSnapshotTrack = {
  id: string;
  title: string;
  author: string;
  url: string;
  thumbnail: string;
  durationMs: number;
};

export type QueueSnapshot = {
  status: 'idle' | 'playing' | 'paused';
  currentTrack: QueueSnapshotTrack | null;
  queue: QueueSnapshotTrack[];
  volume: number;
  progressMs: number;
};

function toSnapshotTrack(track: Track): QueueSnapshotTrack {
  return {
    id: track.id,
    title: track.title,
    author: track.author,
    url: track.url,
    thumbnail: track.thumbnail,
    durationMs: track.durationMS,
  };
}

export function buildQueueSnapshot(queue: GuildQueue | null): QueueSnapshot {
  if (!queue) {
    return {
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    };
  }

  const status: QueueSnapshot['status'] = queue.node.isPaused()
    ? 'paused'
    : queue.node.isPlaying()
      ? 'playing'
      : 'idle';

  return {
    status,
    currentTrack: queue.currentTrack ? toSnapshotTrack(queue.currentTrack) : null,
    queue: queue.tracks.toArray().map(toSnapshotTrack),
    volume: queue.node.volume,
    progressMs: queue.node.playbackTime,
  };
}
