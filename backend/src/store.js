import { DatabaseSync } from "node:sqlite";

/** Durable replay protection. Nonces are the ones this backend signed into rp_context and are
 * single-use. Nullifiers identify a human for this app; each is bound to one Vault so one person
 * cannot keep two agents alive, while the same person can re-verify for their own Vault. */
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS humans (nullifier TEXT PRIMARY KEY, vault TEXT NOT NULL, credential TEXT NOT NULL, first_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_events (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL);
  `);
  const insertNonce = db.prepare("INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)");
  const useNonce = db.prepare("UPDATE nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND expires_at >= ?");
  const findHuman = db.prepare("SELECT vault FROM humans WHERE nullifier = ?");
  const insertHuman = db.prepare("INSERT INTO humans (nullifier, vault, credential, first_seen) VALUES (?, ?, ?, ?)");
  const insertEvent = db.prepare("INSERT INTO agent_events (at, kind, title, detail) VALUES (?, ?, ?, ?)");
  const recentEvents = db.prepare("SELECT at, kind, title, detail FROM agent_events ORDER BY at DESC, id DESC LIMIT ?");

  return {
    issueNonce(nonce, expiresAt) {
      insertNonce.run(nonce, expiresAt);
    },
    /** Atomically consumes a nonce. False if unknown, expired, or already used. */
    consumeNonce(nonce, now = Math.floor(Date.now() / 1000)) {
      return useNonce.run(now, nonce, now).changes === 1;
    },
    /** Binds a nullifier to a vault on first sight. False if it is already bound to another vault. */
    bindHuman(nullifier, vault, credential, now = Math.floor(Date.now() / 1000)) {
      const row = findHuman.get(nullifier);
      if (row) return row.vault.toLowerCase() === vault.toLowerCase();
      insertHuman.run(nullifier, vault, credential, now);
      return true;
    },
    /** Off-chain agent events (a refused attempt leaves no on-chain trace). Shown in the feed. */
    addEvent(kind, title, detail, at = Math.floor(Date.now() / 1000)) {
      insertEvent.run(at, kind, title, detail);
    },
    recentEvents(limit = 20) {
      return recentEvents.all(limit).map((e) => ({ ...e, at: Number(e.at), block: 0, logIndex: 0, tx: null, offchain: true }));
    },
    close() {
      db.close();
    },
  };
}
