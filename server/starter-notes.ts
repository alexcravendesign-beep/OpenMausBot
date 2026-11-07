// Starter notes are the New bot defaults' memory files (Settings → Defaults for new bots). The New bot route writes
// them as it creates a bot; a bot a Chief of Staff creates through team setup is made by the store alone, so it gets
// them here. A file the bot already has is left alone: a replayed receipt, or a bot that has started writing its own
// notes, keeps what is there.
import { existsSync } from "node:fs";
import { join } from "node:path";
import { journalMemoryWrite, type JournaledWriteOptions } from "./memory-journal.ts";
import type { NewBotDefaults } from "./new-bot-defaults.ts";
import { workspaceDir } from "./workspace.ts";

/** Writes each starter note the bot does not have yet; returns the paths written. */
export function seedStarterNotes(
  botId: string,
  defaults: Pick<NewBotDefaults, "memory"> | undefined,
  opts: Omit<JournaledWriteOptions, "expectedHash">,
): string[] {
  const written: string[] = [];
  for (const [path, text] of Object.entries(defaults?.memory ?? {})) {
    if (existsSync(join(workspaceDir(botId), path))) continue;
    journalMemoryWrite(botId, path, text, { actor: opts.actor, via: opts.via, threadId: opts.threadId });
    written.push(path);
  }
  return written;
}
