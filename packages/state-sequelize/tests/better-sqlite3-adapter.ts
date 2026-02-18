import Database from 'better-sqlite3';

export class SQLite3Wrapper {
    private db!: Database.Database;

    constructor(filename: string, mode?: number | Function, callback?: Function) {
        if (typeof mode === 'function') {
            callback = mode;
            mode = undefined;
        }

        try {
            this.db = new Database(filename);
            if (callback) {
                const cb = callback; // Function
                setTimeout(() => cb(null), 0);
            }
        } catch (err) {
            if (callback) {
                const cb = callback;
                setTimeout(() => cb(err), 0);
            }
            else throw err;
        }
    }

    run(sql: string, ...params: any[]) {
        const callback = params[params.length - 1];
        let args = params;

        if (typeof callback === 'function') {
            args = params.slice(0, -1);
        }

        try {
            const stmt = this.db.prepare(sql);
            const info = stmt.run(...args);

            if (typeof callback === 'function') {
                const lastID = Number(info.lastInsertRowid); // Sequelize v6 expects number
                callback.call({ lastID, changes: info.changes }, null);
            }
        } catch (err) {
            console.error('SQLite3Wrapper run error:', err);
            if (typeof callback === 'function') {
                callback(err);
            } else {
                throw err;
            }
        }
        return this;
    }

    all(sql: string, ...params: any[]) {
        const callback = params[params.length - 1];
        let args = params;

        if (typeof callback === 'function') {
            args = params.slice(0, -1);
        }

        try {
            const rows = this.db.prepare(sql).all(...args);
            if (typeof callback === 'function') {
                callback(null, rows);
            }
        } catch (err) {
            console.error('SQLite3Wrapper all error:', err);
            if (typeof callback === 'function') {
                callback(err);
            } else {
                throw err;
            }
        }
        return this;
    }

    close(callback?: Function) {
        try {
            this.db.close();
            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
    }

    exec(sql: string, callback?: Function) {
        try {
            this.db.exec(sql);
            if (callback) callback(null);
        } catch (err) {
            if (callback) callback(err);
        }
        return this;
    }

    serialize(callback?: Function) {
        if (callback) callback();
    }

    parallelize(callback?: Function) {
        if (callback) callback();
    }
}
