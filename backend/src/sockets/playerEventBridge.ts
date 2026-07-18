import type { Server } from 'socket.io';
import { GuildQueueEvent } from 'discord-player';
import type { GuildQueue, Player } from 'discord-player';
import { buildQueueSnapshot } from './buildQueueSnapshot';

const BRIDGED_EVENTS = [
  GuildQueueEvent.PlayerStart,
  GuildQueueEvent.AudioTrackAdd,
  GuildQueueEvent.AudioTracksAdd,
  GuildQueueEvent.AudioTrackRemove,
  GuildQueueEvent.PlayerSkip,
  GuildQueueEvent.PlayerPause,
  GuildQueueEvent.PlayerResume,
  GuildQueueEvent.VolumeChange,
  GuildQueueEvent.EmptyQueue,
  GuildQueueEvent.Disconnect,
  GuildQueueEvent.PlayerError,
] as const;

export function registerPlayerEventBridge(player: Player, io: Server): void {
  const broadcast = (queue: GuildQueue): void => {
    const snapshot = buildQueueSnapshot(queue);
    io.to(`guild:${queue.guild.id}`).emit('queue:state', snapshot);
  };

  for (const event of BRIDGED_EVENTS) {
    player.events.on(event, broadcast);
  }

  player.events.on(GuildQueueEvent.PlayerError, (queue, error, track) => {
    console.error(`[player] error playing "${track.title}" in guild ${queue.guild.id}:`, error);
  });

  player.events.on(GuildQueueEvent.Error, (queue, error) => {
    console.error(`[player] queue error in guild ${queue.guild.id}:`, error);
  });

  player.events.on(GuildQueueEvent.Debug, (queue, message) => {
    console.log(`[player] debug [guild ${queue.guild.id}]: ${message}`);
  });

  player.events.on(GuildQueueEvent.Disconnect, (queue) => {
    console.log(`[player] disconnected from voice in guild ${queue.guild.id}`);
  });

  player.events.on(GuildQueueEvent.ConnectionDestroyed, (queue) => {
    console.log(`[player] voice connection destroyed in guild ${queue.guild.id}`);
  });
}
