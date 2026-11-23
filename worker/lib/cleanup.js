// Removes expired sessions and stale login-attempt counters.
// Safe to run any time: it only deletes rows that are already useless.
export async function cleanup(db) {
  const [sessions, attempts] = await db.batch([
    db.prepare("DELETE FROM sessions WHERE expires_at <= datetime('now')"),
    db.prepare("DELETE FROM login_attempts WHERE window_start <= datetime('now', '-1 day')"),
  ]);
  return {
    sessions: sessions.meta.changes,
    login_attempts: attempts.meta.changes,
  };
}