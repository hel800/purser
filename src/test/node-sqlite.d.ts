// The part of Node's built-in node:sqlite the SQL mock uses; the project
// has no @types/node (the app code runs in a webview, not in Node).
declare module "node:sqlite" {
  type SqlValue = null | number | bigint | string | Uint8Array;

  export class StatementSync {
    run(...values: SqlValue[]): { changes: number | bigint; lastInsertRowid: number | bigint };
    all(...values: SqlValue[]): Record<string, SqlValue>[];
  }

  export class DatabaseSync {
    constructor(path: string);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
