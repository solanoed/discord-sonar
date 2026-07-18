import { Readable } from 'node:stream';
import { Client } from 'discord.js';
import { Player, onStreamExtracted } from 'discord-player';
import { AttachmentExtractor, SoundCloudExtractor } from '@discord-player/extractor';
import { YoutubeiExtractor } from 'discord-player-youtubei';
import ffmpegPath from 'ffmpeg-static';

export type CreatePlayerOptions = {
  youtubeCookie?: string;
};

// TEMP diagnostic for the ~120ms playback cutoff investigation.
// Logs byte flow on the raw extractor stream, before ffmpeg touches it, to
// tell whether the source is being truncated upstream or ffmpeg is cutting
// a stream that's actually still flowing. Remove once root cause is found.
onStreamExtracted(async (stream, track) => {
  if (!(stream instanceof Readable)) {
    console.log(`[stream-diag] "${track.title}" extractor returned non-Readable (${typeof stream}), skipping instrumentation`);
    return stream;
  }

  const start = Date.now();
  let bytes = 0;

  stream.on('data', (chunk: Buffer) => {
    bytes += chunk.length;
  });
  stream.on('end', () => {
    console.log(`[stream-diag] "${track.title}" source stream ENDED after ${Date.now() - start}ms, ${bytes} bytes`);
  });
  stream.on('close', () => {
    console.log(`[stream-diag] "${track.title}" source stream CLOSED after ${Date.now() - start}ms, ${bytes} bytes`);
  });
  stream.on('error', (err) => {
    console.log(`[stream-diag] "${track.title}" source stream ERROR after ${Date.now() - start}ms, ${bytes} bytes:`, err);
  });

  return stream;
});

export async function createPlayer(client: Client, options: CreatePlayerOptions = {}): Promise<Player> {
  const player = new Player(client, { skipFFmpeg: false, ffmpegPath: ffmpegPath ?? undefined });

  // TEMP: this is the global extractor-execution debug channel (Player#debug),
  // distinct from the per-guild queue debug already bridged in
  // playerEventBridge.ts. It's the only place "Extractor X failed with
  // error: ..." gets logged, which is what's currently swallowed and hiding
  // why YoutubeiExtractor falls back to a naked CDN URL for ffmpeg.
  player.on('debug', (message) => console.log(`[player-debug] ${message}`));

  await player.extractors.register(SoundCloudExtractor, {});
  await player.extractors.register(YoutubeiExtractor, {
    cookie: options.youtubeCookie,
  });
  await player.extractors.register(AttachmentExtractor, {});
  return player;
}
