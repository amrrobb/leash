import { DatabaseSync } from "node:sqlite";

/** Durable replay protection. Nonces are the ones this backend signed into rp_context and are
 * single-use. Nullifiers identify a human for this app; each Vault remembers the first human who
 * verified for it, so nobody else can renew that agent, while the same person can re-verify, and may
 * have as many vaults as they like. */
export function openStore(path) {
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE IF NOT EXISTS nonces (nonce TEXT PRIMARY KEY, expires_at INTEGER NOT NULL, used_at INTEGER);
    CREATE TABLE IF NOT EXISTS vault_humans (vault TEXT PRIMARY KEY COLLATE NOCASE, nullifier TEXT NOT NULL, credential TEXT NOT NULL, first_seen INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS agent_events (id INTEGER PRIMARY KEY AUTOINCREMENT, vault TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, kind TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL);
  `);
  const insertNonce = db.prepare("INSERT INTO nonces (nonce, expires_at) VALUES (?, ?)");
  const useNonce = db.prepare("UPDATE nonces SET used_at = ? WHERE nonce = ? AND used_at IS NULL AND expires_at >= ?");
  const findVaultHuman = db.prepare("SELECT nullifier FROM vault_humans WHERE vault = ?");
  const unbindVault = db.prepare("DELETE FROM vault_humans WHERE vault = ?");
  const insertHuman = db.prepare("INSERT INTO vault_humans (vault, nullifier, credential, first_seen) VALUES (?, ?, ?, ?)");
  const insertEvent = db.prepare("INSERT INTO agent_events (vault, at, kind, title, detail) VALUES (?, ?, ?, ?, ?)");
  const recentEvents = db.prepare("SELECT at, kind, title, detail FROM agent_events WHERE vault = ? COLLATE NOCASE ORDER BY at DESC, id DESC LIMIT ?");

  return {
    issueNonce(nonce, expiresAt) {
      insertNonce.run(nonce, expiresAt);
    },
    /** Atomically consumes a nonce. False if unknown, expired, or already used. */
    consumeNonce(nonce, now = Math.floor(Date.now() / 1000)) {
      return useNonce.run(now, nonce, now).changes === 1;
    },
    /** One human per vault, one vault per human. The first proof binds them; after that only that
     * human can renew this vault, and that human cannot back a second vault. */
    /** One human per vault: the first verified person becomes the vault's human and only they can renew it.
     * A human may have any number of vaults (a second strategy, a new vault after withdrawing); the binding is per vault. */
    bindHuman(nullifier, vault, credential, now = Math.floor(Date.now() / 1000)) {
      const row = findVaultHuman.get(vault);
      if (row) return row.nullifier === nullifier;
      insertHuman.run(vault, nullifier, credential, now);
      return true;
    },
    /** Demo/owner escape hatch: forget who this vault's human is (e.g. the presenter takes over). */
    unbindVault(vault) {
      return unbindVault.run(vault).changes;
    },
    /** Off-chain agent events (a refused attempt leaves no on-chain trace). Shown in the feed. */
    addEvent(vault, kind, title, detail, at = Math.floor(Date.now() / 1000)) {
      insertEvent.run(vault, at, kind, title, detail);
    },
    recentEvents(vault, limit = 20) {
      return recentEvents.all(vault, limit).map((e) => ({ ...e, at: Number(e.at), block: 0, logIndex: 0, tx: null, offchain: true }));
    },
    close() {
      db.close();
    },
  };
}
