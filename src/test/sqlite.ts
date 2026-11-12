import { DatabaseSync } from "node:sqlite";
import type { IpcArgs, IpcHandler } from "./ipc";

// the backend's own schema files, so app and tests can't drift apart
const migrations = import.meta.glob<string>("../../src-tauri/migrations/*.sql", {
  query: "?raw",
  import: "default",
  eager: true,
});

/** A fresh in-memory database with every migration applied in order. */
export function createDatabase(): DatabaseSync {
  const db = new DatabaseSync(":memory:");
  for (const path of Object.keys(migrations).sort()) db.exec(migrations[path]);
  return db;
}

// The plugin binds `$1, $2, …`; node:sqlite would read those as named
// parameters, while SQLite's `?1, ?2, …` bind positionally like the plugin.
const positional = (query: string) => query.replace(/\$(\d+)/g, "?$1");
const values = (args: IpcArgs) => ((args.values as unknown[]) ?? []).map((v) => v ?? null) as never[];

/**
 * IPC handlers for @tauri-apps/plugin-sql, backed by `db`, so the real
 * queries in db.ts run against the real schema.
 */
export function sqlHandlers(db: DatabaseSync): Record<string, IpcHandler> {
  return {
    "plugin:sql|load": (args) => args.db,
    "plugin:sql|execute": (args) => {
      const result = db.prepare(positional(args.query as string)).run(...values(args));
      return [Number(result.changes), Number(result.lastInsertRowid)];
    },
    "plugin:sql|select": (args) => db.prepare(positional(args.query as string)).all(...values(args)),
    "plugin:sql|close": () => true,
  };
}
