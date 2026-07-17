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
