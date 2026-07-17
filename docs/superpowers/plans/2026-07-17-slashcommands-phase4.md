# Slash Commands (Phase 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A second control surface — 9 Discord slash commands (`/play`, `/skip`, `/pause`, `/resume`, `/volume`, `/queue`, `/remove`, `/shuffle`, `/stop`) — reusing exactly the same `queueService` functions the REST API (Phase 3b) already calls, plus a registration script to deploy them to a test guild.

**Architecture:** Each command is a small, independently-testable module exporting `{ data, execute }`. `execute` takes a discord.js `ChatInputCommandInteraction` and an injected `CommandDeps = { client, player }` — no module-level singletons, same dependency-injection style as every prior phase. `Command.data` is typed with a minimal structural interface (`{ name: string; toJSON(): unknown }`) rather than the exact `SlashCommandBuilder` subtype, since discord.js's builder chain (`.addStringOption(...)`) returns a different type per command and forcing one exact type would require unnecessary casts. No `requireGuildAdmin` — open to anyone in the server, matching typical music-bot UX; Discord's own per-channel/role permissions are the gate if a server admin wants one.

**Tech Stack:** discord.js (`SlashCommandBuilder`, `Collection`, `ChatInputCommandInteraction`, `REST`, `Routes` — all confirmed exported from the `discord.js` package itself, which re-exports `@discordjs/builders`, `@discordjs/rest`, and `discord-api-types/v10`), vitest with fake interaction/client objects (no real Discord network calls in any test).

## Global Constraints

- Node.js ≥ 18.17, CommonJS not ESM, zero comments, pnpm workspace, TDD via vitest.
- No test may make a real Discord API call — all commands are tested with fake `ChatInputCommandInteraction`/`Client`/`Player` objects (`vi.fn()` for `deferReply`/`editReply`/`options.getString`/`getInteger`), and `queueService` is mocked via namespace import (same pattern as `authRoutes.ts`/`queueRoutes.ts`).
- No placeholder/TODO code.
- Every command calls `queueService` (or `buildQueueSnapshot`) — never touches `discord-player`/`discord.js` playback internals directly. This keeps REST and slash commands as two thin surfaces over one shared implementation.
- Every command calls `interaction.deferReply()` before doing any async work, and `interaction.editReply(...)` exactly once to respond.
- No guild-admin restriction on any command (confirmed decision — do not add `requireGuildAdmin` or any permission check beyond "must be used in a server").

---

### Task 1: `commands/types.ts` + `commands/play.ts`

**Files:**
- Create: `backend/src/commands/types.ts`
- Create: `backend/src/commands/play.ts`
- Test: `backend/src/commands/play.test.ts`

**Interfaces:**
- Consumes: `addTrack`, `NotInVoiceChannelError`, `NoSearchResultsError`, `VoiceConnectionError` from `backend/src/services/queueService.ts` (Phase 3b).
- Produces: `Command` type (`{ data: { name: string; toJSON(): unknown }; execute: (interaction: ChatInputCommandInteraction, deps: CommandDeps) => Promise<void> }`), `CommandDeps` type (`{ client: Client; player: Player }`), and `playCommand: Command`. Every other task in this plan imports `Command`/`CommandDeps` from this file; Task 5 imports `playCommand` into the registry.

- [ ] **Step 1: Write the failing tests**

`backend/src/commands/play.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { playCommand } from './play';

function fakeInteraction(query: string, guildId: string | null = 'guild-1') {
  return {
    guildId,
    user: { id: 'user-1' },
    options: { getString: vi.fn(() => query) },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('playCommand', () => {
  it('has the expected command name', () => {
    expect(playCommand.data.name).toBe('play');
  });

  it('adds the track and confirms it in the reply', async () => {
    vi.spyOn(queueService, 'addTrack').mockResolvedValue(undefined);
    const interaction = fakeInteraction('never gonna give you up');

    await playCommand.execute(interaction, deps);

    expect(interaction.deferReply).toHaveBeenCalledTimes(1);
    expect(queueService.addTrack).toHaveBeenCalledWith(deps.client, deps.player, 'guild-1', 'user-1', 'never gonna give you up');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('never gonna give you up'));
  });

  it('replies with a friendly message when the user is not in a voice channel', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.NotInVoiceChannelError());
    const interaction = fakeInteraction('song');

    await playCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('voice channel'));
  });

  it('replies with a friendly message when no search results are found', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.NoSearchResultsError('song'));
    const interaction = fakeInteraction('song');

    await playCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('No results'));
  });

  it('replies with a friendly message when the voice connection fails', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new queueService.VoiceConnectionError());
    const interaction = fakeInteraction('song');

    await playCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('permission'));
  });

  it('replies with a generic error message for anything unexpected', async () => {
    vi.spyOn(queueService, 'addTrack').mockRejectedValue(new Error('boom'));
    const interaction = fakeInteraction('song');

    await playCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('wrong'));
  });

  it('replies without calling addTrack when used outside a server', async () => {
    vi.spyOn(queueService, 'addTrack');
    const interaction = fakeInteraction('song', null);

    await playCommand.execute(interaction, deps);

    expect(queueService.addTrack).not.toHaveBeenCalled();
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('server'));
  });
});
```

Note: this test mocks `queueService.addTrack` via `vi.spyOn(queueService, 'addTrack')`, which requires `play.ts` to import the module as a namespace (`import * as queueService from '../services/queueService'`) and call `queueService.addTrack(...)` — not a named import. Same reason as `authRoutes.ts`/`queueRoutes.ts` in earlier phases.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- play.test.ts`
Expected: FAIL with "Cannot find module './play'" (and `./types`, transitively).

- [ ] **Step 3: Write the implementation**

`backend/src/commands/types.ts`:

```ts
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';

export type CommandDeps = {
  client: Client;
  player: Player;
};

export type Command = {
  data: { name: string; toJSON(): unknown };
  execute: (interaction: ChatInputCommandInteraction, deps: CommandDeps) => Promise<void>;
};
```

`backend/src/commands/play.ts`:

```ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder()
  .setName('play')
  .setDescription('Play a track in your current voice channel')
  .addStringOption((option) => option.setName('query').setDescription('Song name or URL').setRequired(true));

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();

  const guildId = interaction.guildId;
  const query = interaction.options.getString('query', true);

  if (!guildId) {
    await interaction.editReply('This command only works in a server.');
    return;
  }

  try {
    await queueService.addTrack(deps.client, deps.player, guildId, interaction.user.id, query);
    await interaction.editReply(`Added **${query}** to the queue.`);
  } catch (error) {
    if (error instanceof queueService.NotInVoiceChannelError) {
      await interaction.editReply('You need to be in a voice channel.');
    } else if (error instanceof queueService.NoSearchResultsError) {
      await interaction.editReply('No results found for that search.');
    } else if (error instanceof queueService.VoiceConnectionError) {
      await interaction.editReply("I don't have permission to join that channel.");
    } else {
      await interaction.editReply('Something went wrong while adding that track.');
    }
  }
}

export const playCommand: Command = { data, execute };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- play.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/commands/types.ts backend/src/commands/play.ts backend/src/commands/play.test.ts
git commit -m "feat: add command types and /play slash command"
```

---

### Task 2: `commands/skip.ts`, `pause.ts`, `resume.ts`, `stop.ts`

**Files:**
- Create: `backend/src/commands/skip.ts`, `backend/src/commands/skip.test.ts`
- Create: `backend/src/commands/pause.ts`, `backend/src/commands/pause.test.ts`
- Create: `backend/src/commands/resume.ts`, `backend/src/commands/resume.test.ts`
- Create: `backend/src/commands/stop.ts`, `backend/src/commands/stop.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandDeps` (Task 1); `skip`, `pause`, `resume`, `stop` from `queueService` (Phase 3b).
- Produces: `skipCommand`, `pauseCommand`, `resumeCommand`, `stopCommand: Command`. Task 5 imports all four into the registry.

These four commands are structurally identical: no options, call one boolean-returning `queueService` function, reply with a fixed success message or "nothing is playing" on `false`.

- [ ] **Step 1: Write the failing tests**

`backend/src/commands/skip.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { skipCommand } from './skip';

function fakeInteraction(guildId: string | null = 'guild-1') {
  return {
    guildId,
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('skipCommand', () => {
  it('has the expected command name', () => {
    expect(skipCommand.data.name).toBe('skip');
  });

  it('replies with a success message when the skip succeeds', async () => {
    vi.spyOn(queueService, 'skip').mockReturnValue(true);
    const interaction = fakeInteraction();

    await skipCommand.execute(interaction, deps);

    expect(queueService.skip).toHaveBeenCalledWith(deps.player, 'guild-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Skipped'));
  });

  it('replies that nothing is playing when there is no active queue', async () => {
    vi.spyOn(queueService, 'skip').mockReturnValue(false);
    const interaction = fakeInteraction();

    await skipCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });
});
```

`backend/src/commands/pause.test.ts`, `resume.test.ts`, `stop.test.ts` follow the identical shape — same two tests, swapping `skipCommand`/`skip`/`'skip'`/`'Skipped'` for `pauseCommand`/`pause`/`'pause'`/`'Paused'`, `resumeCommand`/`resume`/`'resume'`/`'Resumed'`, and `stopCommand`/`stop`/`'stop'`/`'Stopped'` respectively.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- skip.test.ts pause.test.ts resume.test.ts stop.test.ts`
Expected: FAIL with "Cannot find module" for each of the four command files.

- [ ] **Step 3: Write the implementation**

`backend/src/commands/skip.ts`:

```ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder().setName('skip').setDescription('Skip the current track');

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;

  if (!guildId || !queueService.skip(deps.player, guildId)) {
    await interaction.editReply('Nothing is playing in this server.');
    return;
  }

  await interaction.editReply('Skipped.');
}

export const skipCommand: Command = { data, execute };
```

`backend/src/commands/pause.ts` (identical shape, `pause`/`'Paused.'`):

```ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder().setName('pause').setDescription('Pause playback');

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;

  if (!guildId || !queueService.pause(deps.player, guildId)) {
    await interaction.editReply('Nothing is playing in this server.');
    return;
  }

  await interaction.editReply('Paused.');
}

export const pauseCommand: Command = { data, execute };
```

`backend/src/commands/resume.ts` (identical shape, `resume`/`'Resumed.'`):

```ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder().setName('resume').setDescription('Resume playback');

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;

  if (!guildId || !queueService.resume(deps.player, guildId)) {
    await interaction.editReply('Nothing is playing in this server.');
    return;
  }

  await interaction.editReply('Resumed.');
}

export const resumeCommand: Command = { data, execute };
```

`backend/src/commands/stop.ts` (identical shape, `stop`/`'Stopped.'`):

```ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder().setName('stop').setDescription('Stop playback and clear the queue');

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;

  if (!guildId || !queueService.stop(deps.player, guildId)) {
    await interaction.editReply('Nothing is playing in this server.');
    return;
  }

  await interaction.editReply('Stopped.');
}

export const stopCommand: Command = { data, execute };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- skip.test.ts pause.test.ts resume.test.ts stop.test.ts`
Expected: PASS, 12 tests (3 each: command name, success reply, nothing-playing reply).

- [ ] **Step 5: Commit**

```bash
git add backend/src/commands/skip.ts backend/src/commands/skip.test.ts backend/src/commands/pause.ts backend/src/commands/pause.test.ts backend/src/commands/resume.ts backend/src/commands/resume.test.ts backend/src/commands/stop.ts backend/src/commands/stop.test.ts
git commit -m "feat: add /skip, /pause, /resume, /stop slash commands"
```

---

### Task 3: `commands/volume.ts`, `remove.ts`

**Files:**
- Create: `backend/src/commands/volume.ts`, `backend/src/commands/volume.test.ts`
- Create: `backend/src/commands/remove.ts`, `backend/src/commands/remove.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandDeps` (Task 1); `setVolume`, `InvalidVolumeError`, `remove` from `queueService` (Phase 3b); `buildQueueSnapshot` from `backend/src/sockets/buildQueueSnapshot.ts` (Phase 2, for `remove`'s position→trackId lookup).
- Produces: `volumeCommand`, `removeCommand: Command`. Task 5 imports both into the registry.

- [ ] **Step 1: Write the failing tests**

`backend/src/commands/volume.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { volumeCommand } from './volume';

function fakeInteraction(amount: number, guildId: string | null = 'guild-1') {
  return {
    guildId,
    options: { getInteger: vi.fn(() => amount) },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('volumeCommand', () => {
  it('has the expected command name', () => {
    expect(volumeCommand.data.name).toBe('volume');
  });

  it('sets the volume and confirms it', async () => {
    vi.spyOn(queueService, 'setVolume').mockReturnValue(true);
    const interaction = fakeInteraction(50);

    await volumeCommand.execute(interaction, deps);

    expect(queueService.setVolume).toHaveBeenCalledWith(deps.player, 'guild-1', 50);
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('50'));
  });

  it('replies that nothing is playing when there is no active queue', async () => {
    vi.spyOn(queueService, 'setVolume').mockReturnValue(false);
    const interaction = fakeInteraction(50);

    await volumeCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });

  it('replies with a friendly message when the volume is out of range', async () => {
    vi.spyOn(queueService, 'setVolume').mockImplementation(() => {
      throw new queueService.InvalidVolumeError();
    });
    const interaction = fakeInteraction(500);

    await volumeCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('between 0 and 100'));
  });
});
```

`backend/src/commands/remove.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import * as snapshotModule from '../sockets/buildQueueSnapshot';
import { removeCommand } from './remove';

function fakeInteraction(position: number, guildId: string | null = 'guild-1') {
  return {
    guildId,
    options: { getInteger: vi.fn(() => position) },
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('removeCommand', () => {
  it('has the expected command name', () => {
    expect(removeCommand.data.name).toBe('remove');
  });

  it('removes the track at the given position and confirms it', async () => {
    vi.spyOn(snapshotModule, 'buildQueueSnapshot').mockReturnValue({
      status: 'playing',
      currentTrack: null,
      queue: [{ id: 'track-1', title: 'Song One', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 }],
      volume: 100,
      progressMs: 0,
    });
    vi.spyOn(queueService, 'remove').mockReturnValue(true);
    const interaction = fakeInteraction(1);

    await removeCommand.execute(interaction, deps);

    expect(queueService.remove).toHaveBeenCalledWith(deps.player, 'guild-1', 'track-1');
    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Song One'));
  });

  it('replies with an invalid-position message when the position is out of range', async () => {
    vi.spyOn(snapshotModule, 'buildQueueSnapshot').mockReturnValue({
      status: 'playing',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
    const interaction = fakeInteraction(1);

    await removeCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Invalid position'));
  });
});
```

Note: `remove.ts` must import `buildQueueSnapshot` as a namespace (`import * as snapshotModule from '../sockets/buildQueueSnapshot'`) and call `snapshotModule.buildQueueSnapshot(...)` for the same `vi.spyOn` reason as elsewhere.

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- volume.test.ts remove.test.ts`
Expected: FAIL with "Cannot find module" for both files.

- [ ] **Step 3: Write the implementation**

`backend/src/commands/volume.ts`:

```ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder()
  .setName('volume')
  .setDescription('Set the playback volume (0-100)')
  .addIntegerOption((option) => option.setName('amount').setDescription('Volume percentage').setRequired(true));

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;
  const amount = interaction.options.getInteger('amount', true);

  if (!guildId) {
    await interaction.editReply('This command only works in a server.');
    return;
  }

  try {
    if (!queueService.setVolume(deps.player, guildId, amount)) {
      await interaction.editReply('Nothing is playing in this server.');
      return;
    }
    await interaction.editReply(`Volume set to ${amount}.`);
  } catch (error) {
    if (error instanceof queueService.InvalidVolumeError) {
      await interaction.editReply('Volume must be between 0 and 100.');
      return;
    }
    throw error;
  }
}

export const volumeCommand: Command = { data, execute };
```

`backend/src/commands/remove.ts`:

```ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import * as snapshotModule from '../sockets/buildQueueSnapshot';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder()
  .setName('remove')
  .setDescription('Remove a track from the queue by position')
  .addIntegerOption((option) =>
    option.setName('position').setDescription('Position in the queue (1 = next up)').setRequired(true),
  );

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;
  const position = interaction.options.getInteger('position', true);

  if (!guildId) {
    await interaction.editReply('This command only works in a server.');
    return;
  }

  const snapshot = snapshotModule.buildQueueSnapshot(deps.player.nodes.get(guildId));
  const track = snapshot.queue[position - 1];

  if (!track) {
    await interaction.editReply('Invalid position.');
    return;
  }

  queueService.remove(deps.player, guildId, track.id);
  await interaction.editReply(`Removed **${track.title}** from the queue.`);
}

export const removeCommand: Command = { data, execute };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- volume.test.ts remove.test.ts`
Expected: PASS, 7 tests (4 volume + 3 remove).

- [ ] **Step 5: Commit**

```bash
git add backend/src/commands/volume.ts backend/src/commands/volume.test.ts backend/src/commands/remove.ts backend/src/commands/remove.test.ts
git commit -m "feat: add /volume and /remove slash commands"
```

---

### Task 4: `commands/queue.ts`, `shuffle.ts`

**Files:**
- Create: `backend/src/commands/queue.ts`, `backend/src/commands/queue.test.ts`
- Create: `backend/src/commands/shuffle.ts`, `backend/src/commands/shuffle.test.ts`

**Interfaces:**
- Consumes: `Command`, `CommandDeps` (Task 1); `shuffle` from `queueService` (Phase 3b); `buildQueueSnapshot` from `backend/src/sockets/buildQueueSnapshot.ts` (Phase 2).
- Produces: `queueCommand`, `shuffleCommand: Command`. Task 5 imports both into the registry.

- [ ] **Step 1: Write the failing tests**

`backend/src/commands/queue.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as snapshotModule from '../sockets/buildQueueSnapshot';
import { queueCommand } from './queue';

function fakeInteraction(guildId: string | null = 'guild-1') {
  return {
    guildId,
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('queueCommand', () => {
  it('has the expected command name', () => {
    expect(queueCommand.data.name).toBe('queue');
  });

  it('replies that nothing is playing when the queue is idle', async () => {
    vi.spyOn(snapshotModule, 'buildQueueSnapshot').mockReturnValue({
      status: 'idle',
      currentTrack: null,
      queue: [],
      volume: 100,
      progressMs: 0,
    });
    const interaction = fakeInteraction();

    await queueCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });

  it('shows the current track and upcoming queue', async () => {
    vi.spyOn(snapshotModule, 'buildQueueSnapshot').mockReturnValue({
      status: 'playing',
      currentTrack: { id: 't1', title: 'Now Playing', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 },
      queue: [{ id: 't2', title: 'Up Next', author: 'A', url: 'u', thumbnail: 't', durationMs: 1000 }],
      volume: 80,
      progressMs: 0,
    });
    const interaction = fakeInteraction();

    await queueCommand.execute(interaction, deps);

    const [message] = (interaction.editReply as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(message).toContain('Now Playing');
    expect(message).toContain('Up Next');
  });
});
```

`backend/src/commands/shuffle.test.ts`:

```ts
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { ChatInputCommandInteraction, Client } from 'discord.js';
import type { Player } from 'discord-player';
import * as queueService from '../services/queueService';
import { shuffleCommand } from './shuffle';

function fakeInteraction(guildId: string | null = 'guild-1') {
  return {
    guildId,
    deferReply: vi.fn(async () => undefined),
    editReply: vi.fn(async () => undefined),
  } as unknown as ChatInputCommandInteraction;
}

const deps = { client: {} as Client, player: {} as Player };

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shuffleCommand', () => {
  it('has the expected command name', () => {
    expect(shuffleCommand.data.name).toBe('shuffle');
  });

  it('replies with a success message when the shuffle succeeds', async () => {
    vi.spyOn(queueService, 'shuffle').mockReturnValue(true);
    const interaction = fakeInteraction();

    await shuffleCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Shuffled'));
  });

  it('replies that nothing is playing when there is no active queue', async () => {
    vi.spyOn(queueService, 'shuffle').mockReturnValue(false);
    const interaction = fakeInteraction();

    await shuffleCommand.execute(interaction, deps);

    expect(interaction.editReply).toHaveBeenCalledWith(expect.stringContaining('Nothing is playing'));
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- queue.test.ts shuffle.test.ts`
Expected: FAIL with "Cannot find module" for both files.

- [ ] **Step 3: Write the implementation**

`backend/src/commands/queue.ts`:

```ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as snapshotModule from '../sockets/buildQueueSnapshot';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder().setName('queue').setDescription('Show the current queue');

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;

  if (!guildId) {
    await interaction.editReply('This command only works in a server.');
    return;
  }

  const snapshot = snapshotModule.buildQueueSnapshot(deps.player.nodes.get(guildId));

  if (!snapshot.currentTrack) {
    await interaction.editReply('Nothing is playing in this server.');
    return;
  }

  const nowPlaying = `Now playing: **${snapshot.currentTrack.title}** (${snapshot.status}, volume ${snapshot.volume})`;
  const upcoming = snapshot.queue.map((track, index) => `${index + 1}. ${track.title}`).join('\n');
  const message = upcoming.length > 0 ? `${nowPlaying}\n\nUp next:\n${upcoming}` : nowPlaying;

  await interaction.editReply(message);
}

export const queueCommand: Command = { data, execute };
```

`backend/src/commands/shuffle.ts`:

```ts
import { SlashCommandBuilder, ChatInputCommandInteraction } from 'discord.js';
import * as queueService from '../services/queueService';
import { Command, CommandDeps } from './types';

const data = new SlashCommandBuilder().setName('shuffle').setDescription('Shuffle the queue');

async function execute(interaction: ChatInputCommandInteraction, deps: CommandDeps): Promise<void> {
  await interaction.deferReply();
  const guildId = interaction.guildId;

  if (!guildId || !queueService.shuffle(deps.player, guildId)) {
    await interaction.editReply('Nothing is playing in this server.');
    return;
  }

  await interaction.editReply('Shuffled the queue.');
}

export const shuffleCommand: Command = { data, execute };
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- queue.test.ts shuffle.test.ts`
Expected: PASS, 6 tests (3 each: command name, success/detail reply, nothing-playing/idle reply).

- [ ] **Step 5: Commit**

```bash
git add backend/src/commands/queue.ts backend/src/commands/queue.test.ts backend/src/commands/shuffle.ts backend/src/commands/shuffle.test.ts
git commit -m "feat: add /queue and /shuffle slash commands"
```

---

### Task 5: `commands/index.ts` (registry) + `events/interactionCreate.ts` (dispatcher)

**Files:**
- Create: `backend/src/commands/index.ts`
- Create: `backend/src/events/interactionCreate.ts`
- Test: `backend/src/commands/index.test.ts`
- Test: `backend/src/events/interactionCreate.test.ts`

**Interfaces:**
- Consumes: all 9 commands from Tasks 1-4.
- Produces: `createCommands(): Collection<string, Command>`, `registerInteractionHandler(client: Client, commands: Collection<string, Command>, deps: CommandDeps): void`. Task 6 (`deployCommands.ts`) calls `createCommands()` to get the JSON bodies to register; Task 7 (`index.ts`) calls both `createCommands()` and `registerInteractionHandler(...)` at boot.

- [ ] **Step 1: Write the failing tests**

`backend/src/commands/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { createCommands } from './index';

describe('createCommands', () => {
  it('registers all 9 commands keyed by their command name', () => {
    const commands = createCommands();

    expect(commands.size).toBe(9);
    expect([...commands.keys()].sort()).toEqual(
      ['pause', 'play', 'queue', 'remove', 'resume', 'shuffle', 'skip', 'stop', 'volume'].sort(),
    );
  });
});
```

`backend/src/events/interactionCreate.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { Collection } from 'discord.js';
import type { Client, ChatInputCommandInteraction } from 'discord.js';
import type { Player } from 'discord-player';
import { Command } from '../commands/types';
import { registerInteractionHandler } from './interactionCreate';

function buildFakeClient() {
  const handlers: Record<string, (...args: unknown[]) => unknown> = {};
  const client = {
    on: vi.fn((event: string, handler: (...args: unknown[]) => unknown) => {
      handlers[event] = handler;
    }),
  } as unknown as Client;
  return { client, handlers };
}

const deps = { client: {} as Client, player: {} as Player };

describe('registerInteractionHandler', () => {
  it('executes the matching command for a known chat input command', async () => {
    const { client, handlers } = buildFakeClient();
    const execute = vi.fn(async () => undefined);
    const commands = new Collection<string, Command>();
    commands.set('skip', { data: { name: 'skip', toJSON: () => ({}) }, execute });

    registerInteractionHandler(client, commands, deps);

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'skip',
    } as unknown as ChatInputCommandInteraction;

    await handlers.interactionCreate(interaction);

    expect(execute).toHaveBeenCalledWith(interaction, deps);
  });

  it('does nothing for an unknown command name', async () => {
    const { client, handlers } = buildFakeClient();
    const execute = vi.fn(async () => undefined);
    const commands = new Collection<string, Command>();
    commands.set('skip', { data: { name: 'skip', toJSON: () => ({}) }, execute });

    registerInteractionHandler(client, commands, deps);

    const interaction = {
      isChatInputCommand: () => true,
      commandName: 'unknown-command',
    } as unknown as ChatInputCommandInteraction;

    await handlers.interactionCreate(interaction);

    expect(execute).not.toHaveBeenCalled();
  });

  it('does nothing for a non-chat-input interaction', async () => {
    const { client, handlers } = buildFakeClient();
    const execute = vi.fn(async () => undefined);
    const commands = new Collection<string, Command>();
    commands.set('skip', { data: { name: 'skip', toJSON: () => ({}) }, execute });

    registerInteractionHandler(client, commands, deps);

    const interaction = {
      isChatInputCommand: () => false,
    } as unknown as ChatInputCommandInteraction;

    await handlers.interactionCreate(interaction);

    expect(execute).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter backend test -- commands/index.test.ts interactionCreate.test.ts`
Expected: FAIL with "Cannot find module './index'" and "Cannot find module './interactionCreate'".

- [ ] **Step 3: Write the implementation**

`backend/src/commands/index.ts`:

```ts
import { Collection } from 'discord.js';
import { Command } from './types';
import { playCommand } from './play';
import { skipCommand } from './skip';
import { pauseCommand } from './pause';
import { resumeCommand } from './resume';
import { volumeCommand } from './volume';
import { queueCommand } from './queue';
import { removeCommand } from './remove';
import { shuffleCommand } from './shuffle';
import { stopCommand } from './stop';

export function createCommands(): Collection<string, Command> {
  const commands = new Collection<string, Command>();

  for (const command of [
    playCommand,
    skipCommand,
    pauseCommand,
    resumeCommand,
    volumeCommand,
    queueCommand,
    removeCommand,
    shuffleCommand,
    stopCommand,
  ]) {
    commands.set(command.data.name, command);
  }

  return commands;
}
```

`backend/src/events/interactionCreate.ts`:

```ts
import type { Client } from 'discord.js';
import { Collection } from 'discord.js';
import { Command, CommandDeps } from '../commands/types';

export function registerInteractionHandler(
  client: Client,
  commands: Collection<string, Command>,
  deps: CommandDeps,
): void {
  client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = commands.get(interaction.commandName);
    if (!command) return;

    await command.execute(interaction, deps);
  });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter backend test -- commands/index.test.ts interactionCreate.test.ts`
Expected: PASS, 4 tests (1 + 3).

- [ ] **Step 5: Commit**

```bash
git add backend/src/commands/index.ts backend/src/commands/index.test.ts backend/src/events/interactionCreate.ts backend/src/events/interactionCreate.test.ts
git commit -m "feat: add command registry and interactionCreate dispatcher"
```

---

### Task 6: `TEST_GUILD_ID` env var + `deployCommands.ts` script

**Files:**
- Modify: `backend/src/config/env.ts`
- Modify: `backend/src/config/env.test.ts`
- Modify: `backend/.env.example`
- Modify: `backend/package.json` (add `deploy-commands` script)
- Create: `backend/src/deployCommands.ts`

**Interfaces:**
- Consumes: `createCommands()` (Task 5), `loadEnv()` (existing, extended here).
- Produces: `Env.TEST_GUILD_ID?: string`, and a standalone runnable script. No later task in this plan depends on this file.

- [ ] **Step 1: Write the failing test**

Add to `backend/src/config/env.test.ts` (keep the existing 8 tests, add this one):

```ts
  it('leaves TEST_GUILD_ID undefined when absent, and passes it through when present', () => {
    const withoutIt = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
    });
    expect(withoutIt.TEST_GUILD_ID).toBeUndefined();

    const withIt = loadEnv({
      DISCORD_TOKEN: 'token',
      DISCORD_CLIENT_ID: 'abc',
      DISCORD_CLIENT_SECRET: 'clientsecret',
      JWT_SECRET: 'secret',
      TEST_GUILD_ID: 'guild-123',
    });
    expect(withIt.TEST_GUILD_ID).toBe('guild-123');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter backend test -- env.test.ts`
Expected: FAIL — `TEST_GUILD_ID` isn't in the schema yet, so `withIt.TEST_GUILD_ID` would be `undefined` instead of `'guild-123'` (zod strips unknown keys by default).

- [ ] **Step 3: Write the implementation**

`backend/src/config/env.ts`:

```ts
import { z } from 'zod';

const envSchema = z.object({
  DISCORD_TOKEN: z.string().min(1),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().min(1),
  JWT_SECRET: z.string().min(1),
  FRONTEND_URL: z.string().url().default('http://localhost:5173'),
  BACKEND_BASE_URL: z.string().url().default('http://localhost:3001'),
  TEST_GUILD_ID: z.string().min(1).optional(),
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  return envSchema.parse(source);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter backend test -- env.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Update `.env.example` and `package.json`**

`backend/.env.example`:

```
DISCORD_TOKEN=
DISCORD_CLIENT_ID=
DISCORD_CLIENT_SECRET=
JWT_SECRET=
FRONTEND_URL=http://localhost:5173
BACKEND_BASE_URL=http://localhost:3001
TEST_GUILD_ID=
PORT=3001
NODE_ENV=development
```

Edit `backend/package.json`: add to `"scripts"`:

```json
    "deploy-commands": "tsx src/deployCommands.ts",
```

- [ ] **Step 6: Write `deployCommands.ts`**

`backend/src/deployCommands.ts`:

```ts
import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { loadEnv } from './config/env';
import { createCommands } from './commands';

async function main(): Promise<void> {
  const env = loadEnv();

  if (!env.TEST_GUILD_ID) {
    throw new Error('TEST_GUILD_ID must be set to deploy commands to a test guild');
  }

  const commands = createCommands();
  const body = commands.map((command) => command.data.toJSON());

  const rest = new REST().setToken(env.DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.TEST_GUILD_ID), { body });

  console.log(`Deployed ${body.length} commands to guild ${env.TEST_GUILD_ID}`);
}

main().catch((error) => {
  console.error('Failed to deploy commands', error);
  process.exit(1);
});
```

This script has no automated test — it makes a real call to Discord's REST API and requires a real bot token and a real guild ID, neither of which exist in this development environment. This mirrors `index.ts`'s existing precedent from Phase 1 onward (manual verification only).

- [ ] **Step 7: Run the full test suite to confirm nothing broke**

Run: `pnpm --filter backend test`
Expected: PASS, all 131 tests: 94 carried over from Phases 1-3b + 7 from Task 1 (`play`) + 12 from Task 2 (`skip`/`pause`/`resume`/`stop`) + 7 from Task 3 (`volume`/`remove`) + 6 from Task 4 (`queue`/`shuffle`) + 4 from Task 5 (`commands/index`/`interactionCreate`) + 1 new `TEST_GUILD_ID` test in this task (env.test.ts goes from 8 to 9).

- [ ] **Step 8: Commit**

```bash
git add backend/src/config/env.ts backend/src/config/env.test.ts backend/.env.example backend/package.json backend/src/deployCommands.ts
git commit -m "feat: add TEST_GUILD_ID env var and deployCommands script"
```

---

### Task 7: Wire `registerInteractionHandler` into `index.ts`

**Files:**
- Modify: `backend/src/index.ts`

**Interfaces:**
- Consumes: `createCommands()`, `registerInteractionHandler()` (Task 5).
- Produces: the running backend process, now dispatching slash command interactions. No further tasks in this plan consume this file.

- [ ] **Step 1: Update `index.ts`**

`backend/src/index.ts`:

```ts
import 'dotenv/config';
import { loadEnv } from './config/env';
import { createDiscordClient } from './bot/createDiscordClient';
import { createPlayer } from './bot/createPlayer';
import { createApp } from './http/createApp';
import { createHttpServer } from './http/createHttpServer';
import { createSocketServer } from './sockets/createSocketServer';
import { registerPlayerEventBridge } from './sockets/playerEventBridge';
import { createCommands } from './commands';
import { registerInteractionHandler } from './events/interactionCreate';

async function main(): Promise<void> {
  const env = loadEnv();
  const client = createDiscordClient();
  const player = await createPlayer(client);

  client.once('ready', (readyClient) => {
    console.log(`Logged in as ${readyClient.user.tag}`);
  });

  const commands = createCommands();
  registerInteractionHandler(client, commands, { client, player });

  const app = createApp(
    {
      oauth: {
        clientId: env.DISCORD_CLIENT_ID,
        clientSecret: env.DISCORD_CLIENT_SECRET,
        redirectUri: `${env.BACKEND_BASE_URL}/api/auth/callback`,
      },
      jwtSecret: env.JWT_SECRET,
      frontendUrl: env.FRONTEND_URL,
      isProduction: env.NODE_ENV === 'production',
      getBotGuildIds: () => client.guilds.cache.map((guild) => guild.id),
    },
    client,
    player,
  );
  const httpServer = createHttpServer(app);
  const io = createSocketServer(httpServer, player);
  registerPlayerEventBridge(player, io);

  httpServer.listen(env.PORT, () => {
    console.log(`HTTP server listening on port ${env.PORT}`);
  });

  await client.login(env.DISCORD_TOKEN);

  process.once('SIGINT', () => {
    client.destroy();
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Fatal error during startup', error);
  process.exit(1);
});
```

- [ ] **Step 2: Run the full test suite to confirm nothing broke**

Run: `pnpm --filter backend test`
Expected: PASS, same 131 tests (this step only touches `index.ts`, which has no automated tests).

- [ ] **Step 3: Manual verification**

Same limitation as every prior phase: no real Discord bot token, test guild, or Discord client exists in this development environment. This is a pending manual step for the user:

1. Fill in `backend/.env` with real `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `JWT_SECRET`, and a `TEST_GUILD_ID` (a real Discord server ID where the bot is already invited).
2. Run `pnpm --filter backend deploy-commands` — expect `Deployed 9 commands to guild <id>` in the console, and the 9 commands to appear immediately in that server (guild-scoped commands propagate instantly, unlike global commands).
3. Run `pnpm --filter backend dev`, then in that Discord server, join a voice channel and run `/play <song>` — expect the bot to join and start playing, followed by `/queue`, `/skip`, `/volume 50`, `/pause`, `/resume`, `/shuffle`, `/remove 1`, `/stop` to each behave as described in the design spec's "Fase 4 — Slash Commands" section.

- [ ] **Step 4: Commit**

```bash
git add backend/src/index.ts
git commit -m "feat: wire slash command registry and interaction handler into entry point"
```
