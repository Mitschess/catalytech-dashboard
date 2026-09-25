"""SQLite persistence for what people do in the app: acknowledgements, work orders and manual interventions.

In production this becomes PostgreSQL; the interface stays the same.
Times are simulated hours so that seeking back in the replay can drop actions from the 'future'.
"""
from __future__ import annotations

import sqlite3
import threading
from pathlib import Path


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(str(path), check_same_thread=False)
        self.db.row_factory = sqlite3.Row
        self.lock = threading.Lock()
        with self.lock, self.db:
            self.db.executescript("""
                CREATE TABLE IF NOT EXISTS acks (alert_id TEXT PRIMARY KEY, h INTEGER NOT NULL, by TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS manual_iv (asset_id TEXT PRIMARY KEY, h INTEGER NOT NULL);
                CREATE TABLE IF NOT EXISTS workorders (
                    id INTEGER PRIMARY KEY AUTOINCREMENT, alert_id TEXT, asset_id TEXT NOT NULL, title TEXT NOT NULL,
                    prio TEXT, owner TEXT, created_h INTEGER NOT NULL, due_h INTEGER, status TEXT NOT NULL,
                    updated_h INTEGER, source TEXT);
            """)

    def clear(self) -> None:
        with self.lock, self.db:
            self.db.executescript("DELETE FROM acks; DELETE FROM manual_iv; DELETE FROM workorders;")

    def prune_after(self, h: int) -> None:
        with self.lock, self.db:
            self.db.execute("DELETE FROM acks WHERE h > ?", (h,))
            self.db.execute("DELETE FROM manual_iv WHERE h > ?", (h,))
            self.db.execute("DELETE FROM workorders WHERE created_h > ?", (h,))

    # acknowledgements
    def acks(self) -> dict:
        with self.lock:
            return {r["alert_id"]: {"h": r["h"], "by": r["by"]} for r in self.db.execute("SELECT * FROM acks")}

    def ack(self, alert_id: str, h: int, by: str) -> None:
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO acks VALUES (?, ?, ?)", (alert_id, h, by))

    # manual interventions
    def manual_ivs(self) -> dict:
        with self.lock:
            return {r["asset_id"]: r["h"] for r in self.db.execute("SELECT * FROM manual_iv")}

    def set_manual_iv(self, asset_id: str, h: int) -> None:
        with self.lock, self.db:
            self.db.execute("INSERT OR REPLACE INTO manual_iv VALUES (?, ?)", (asset_id, h))

    # work orders
    def workorders(self) -> list[dict]:
        with self.lock:
            return [{"id": r["id"], "alertId": r["alert_id"], "assetId": r["asset_id"], "title": r["title"], "prio": r["prio"],
                     "owner": r["owner"], "createdH": r["created_h"], "dueH": r["due_h"], "status": r["status"],
                     "updatedH": r["updated_h"], "source": r["source"]}
                    for r in self.db.execute("SELECT * FROM workorders ORDER BY id DESC")]

    def create_wo(self, **kw) -> int:
        with self.lock, self.db:
            cur = self.db.execute(
                "INSERT INTO workorders (alert_id, asset_id, title, prio, owner, created_h, due_h, status, updated_h, source) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, 'Open', ?, ?)",
                (kw["alert_id"], kw["asset_id"], kw["title"], kw["prio"], kw["owner"], kw["created_h"], kw["due_h"], kw["created_h"], kw["source"]))
            return int(cur.lastrowid)

    def update_wo(self, wo_id: int, status: str, h: int) -> bool:
        with self.lock, self.db:
            cur = self.db.execute("UPDATE workorders SET status = ?, updated_h = ? WHERE id = ?", (status, h, wo_id))
            return cur.rowcount > 0
