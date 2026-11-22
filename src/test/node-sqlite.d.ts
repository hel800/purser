// Minimal types for Node's built-in SQLite (Node 22.5+), used by the database
// tests. `@types/node` is not a dependency of this project.

declare module "node:sqlite" {
  export interface StatementResult {
    changes: number;
    lastInsertRowid: number | bigint;
  }

  export interface Statement {
    run(...params: unknown[]): StatementResult;
    all(...params: unknown[]): Record<string, unknown>[];
    get(...params: unknown[]): Record<string, unknown> | undefined;
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    exec(sql: string): void;
    prepare(sql: string): Statement;
    close(): void;
  }
}
