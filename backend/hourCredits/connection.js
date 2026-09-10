const sqlite3 = require('sqlite3');
// Dedicated connection per operation: unrelated application queries cannot join this transaction.
async function openConnection(filename) {
  const db = await new Promise((resolve, reject) => {
    const value = new sqlite3.Database(filename, err => err ? reject(err) : resolve(value));
  });
  const q = {
    run: (sql, args = []) => new Promise((resolve, reject) => db.run(sql, args, function(err) {
      err ? reject(err) : resolve({ id: this.lastID, changes: this.changes });
    })),
    get: (sql, args = []) => new Promise((resolve, reject) => db.get(sql, args, (err, row) => err ? reject(err) : resolve(row))),
    all: (sql, args = []) => new Promise((resolve, reject) => db.all(sql, args, (err, rows) => err ? reject(err) : resolve(rows))),
    exec: sql => new Promise((resolve, reject) => db.exec(sql, err => err ? reject(err) : resolve())),
    close: () => new Promise((resolve, reject) => db.close(err => err ? reject(err) : resolve()))
  };
  await q.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
  return q;
}
module.exports = { openConnection };
