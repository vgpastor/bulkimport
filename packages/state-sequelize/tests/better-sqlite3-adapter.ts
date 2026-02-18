import Database from 'better-sqlite3';

type SQLiteCallback = (...args: unknown[]) => void;
type BindValue = string | number | bigint | boolean | Buffer | Date | null | Uint8Array;
type BindRecord = Record<string, BindValue>;
type BindParam = BindValue | BindRecord;

interface RunContext {
  lastID: number;
  changes: number;
}

export class SQLite3Wrapper {
  private db!: Database.Database;

  constructor(filename: string, mode?: number | SQLiteCallback, callback?: SQLiteCallback) {
    if (typeof mode === 'function') {
      callback = mode;
    }

    try {
      this.db = new Database(filename);
      if (callback) {
        setTimeout(() => {
          callback(null);
        }, 0);
      }
    } catch (err) {
      if (callback) {
        setTimeout(() => {
          callback(this.toError(err));
        }, 0);
      } else {
        throw err;
      }
    }
  }

  private toError(err: unknown): Error {
    return err instanceof Error ? err : new Error(String(err));
  }

  private isBindRecord(value: unknown): value is BindRecord {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    if (value instanceof Buffer || value instanceof Date || value instanceof Uint8Array) return false;
    return true;
  }

  private normalizeArgs(params: unknown[]): { args: BindParam[]; callback?: SQLiteCallback } {
    let callback: SQLiteCallback | undefined;
    if (params.length > 0 && typeof params[params.length - 1] === 'function') {
      callback = params[params.length - 1] as SQLiteCallback;
      params = params.slice(0, -1);
    }

    const bindParams = params as BindParam[];

    if (bindParams.length === 1 && this.isBindRecord(bindParams[0])) {
      const source = bindParams[0];
      const normalized: BindRecord = {};
      for (const key of Object.keys(source)) {
        const newKey = key.startsWith('$') || key.startsWith(':') || key.startsWith('@') ? key.slice(1) : key;
        normalized[newKey] = source[key];
      }
      bindParams[0] = normalized;
    }

    return { args: bindParams, callback };
  }

  private sanitizeParam(value: BindParam): BindParam {
    if (typeof value === 'boolean') {
      return value ? 1 : 0;
    }
    if (value instanceof Date) {
      return value.getTime();
    }
    return value;
  }

  private sanitizeArgs(args: BindParam[]): BindParam[] {
    return args.map((arg) => {
      if (this.isBindRecord(arg)) {
        const normalized: BindRecord = {};
        for (const key of Object.keys(arg)) {
          normalized[key] = this.sanitizeParam(arg[key]) as BindValue;
        }
        return normalized;
      }
      return this.sanitizeParam(arg);
    });
  }

  run(sql: string, ...params: unknown[]): this {
    const { args: rawArgs, callback } = this.normalizeArgs(params);
    const args = this.sanitizeArgs(rawArgs);

    try {
      const stmt = this.db.prepare(sql);
      const info = stmt.run(...args);

      if (callback) {
        const context: RunContext = {
          lastID: Number(info.lastInsertRowid),
          changes: info.changes,
        };
        callback.call(context, null);
      }
    } catch (err) {
      console.error('SQLite3Wrapper run error:', err);
      if (callback) {
        callback(this.toError(err));
      } else {
        throw err;
      }
    }
    return this;
  }

  all(sql: string, ...params: unknown[]): this {
    const { args: rawArgs, callback } = this.normalizeArgs(params);
    const args = this.sanitizeArgs(rawArgs);

    try {
      const stmt = this.db.prepare(sql);

      // Handle statements that don't return data (create table etc) gracefully when all() is called
      if (stmt.reader) {
        const rows = stmt.all(...args);
        if (callback) {
          callback(null, rows);
        }
      } else {
        stmt.run(...args);
        if (callback) {
          callback(null, []);
        }
      }
    } catch (err) {
      console.error('SQLite3Wrapper all error:', err, sql);
      if (callback) {
        callback(this.toError(err));
      } else {
        throw err;
      }
    }
    return this;
  }

  close(callback?: SQLiteCallback): void {
    try {
      if (this.db.open) {
        this.db.close();
      }
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(this.toError(err));
    }
  }

  exec(sql: string, callback?: SQLiteCallback): this {
    try {
      this.db.exec(sql);
      if (callback) callback(null);
    } catch (err) {
      if (callback) callback(this.toError(err));
    }
    return this;
  }

  serialize(callback?: SQLiteCallback): void {
    if (callback) callback();
  }

  parallelize(callback?: SQLiteCallback): void {
    if (callback) callback();
  }
}
