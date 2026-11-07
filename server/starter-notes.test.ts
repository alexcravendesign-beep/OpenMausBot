import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

import { DATA_DIR } from "./config.ts";
import type { ModelSelection } from "./contracts.ts";
import { seedStarterNotes } from "./starter-notes.ts";
import { Store } from "./store.ts";
import { workspaceDir } from "./workspace.ts";

const selection = (): ModelSelection => ({ instanceId: "claude", model: "claude-sonnet-5" });
const defaults = { memory: { "MEMORY.md": "# Map\n\n- read the brand topic first\n", "memory/brand.md": "---\ntitle: Brand\n---\n\nnavy and cyan\n" } };

describe("seedStarterNotes", () => {
  beforeEach(() => {
    rmSync(DATA_DIR, { recursive: true, force: true });
  });

  it("writes every starter note a new bot lacks, and leaves what a bot already has", () => {
    const bot = new Store(selection).createBot({ name: "Scout" });
    expect(seedStarterNotes(bot.id, defaults, { actor: "person", via: "test" }).sort()).toEqual(["MEMORY.md", "memory/brand.md"]);
    const folder = workspaceDir(bot.id);
    expect(readFileSync(join(folder, "MEMORY.md"), "utf8")).toBe(defaults.memory["MEMORY.md"]);
    expect(readFileSync(join(folder, "memory", "brand.md"), "utf8")).toBe(defaults.memory["memory/brand.md"]);

    writeFileSync(join(folder, "MEMORY.md"), "# Map\n\n- the bot wrote this\n");
    rmSync(join(folder, "memory", "brand.md"));
    expect(seedStarterNotes(bot.id, defaults, { actor: "person", via: "test" })).toEqual(["memory/brand.md"]);
    expect(readFileSync(join(folder, "MEMORY.md"), "utf8")).toBe("# Map\n\n- the bot wrote this\n");
    expect(existsSync(join(folder, "memory", "brand.md"))).toBe(true);
  });

  it("writes nothing without saved defaults", () => {
    const bot = new Store(selection).createBot({ name: "Scout" });
    expect(seedStarterNotes(bot.id, undefined, { actor: "person", via: "test" })).toEqual([]);
    expect(seedStarterNotes(bot.id, { memory: {} }, { actor: "person", via: "test" })).toEqual([]);
  });
});
