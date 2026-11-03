"""Centralised, concurrency-safe Excel data access.

All reads/writes in the application go through ``store``. Writes happen inside
``store.transaction()`` which holds an in-process lock plus a cross-process file
lock, re-reads the workbook if it changed on disk, validates the data and then
persists atomically (temp file + ``os.replace``). If the block raises, the
in-memory cache is reloaded from disk so partial changes are discarded.
"""
import os
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Iterator

import pandas as pd
from filelock import FileLock, Timeout

from app import config

SHEETS: dict[str, list[str]] = {
    "Users": ["User ID", "Employee ID", "Username", "Password Hash", "Role", "Active Status", "Created Date"],
    "Employees": ["Employee ID", "User ID", "Name", "Email", "Phone", "Department", "Designation",
                  "Team Lead ID", "Status", "Joining Date"],
    "Departments": ["Department ID", "Department Name", "Working Days"],
    "Attendance": ["Attendance ID", "Employee ID", "Date", "Check-in Time", "Status"],
    "Leave Types": ["Leave Type ID", "Leave Type Name", "Active"],
    "Leave Requests": ["Request ID", "Employee ID", "Leave Type", "From Date", "To Date", "Reason", "Status",
                       "Approver ID", "Approval Date", "Rejection Reason", "Created Date", "Assigned To"],
    "WFH Requests": ["Request ID", "Employee ID", "From Date", "To Date", "Reason", "Status", "Approver ID",
                     "Approval Date", "Rejection Reason", "Created Date", "Assigned To"],
    "WFH Verifications": ["Verification ID", "Employee ID", "WFH Request ID", "Date", "Verification Type",
                          "Verification Time", "Latitude", "Longitude", "Location Status",
                          "Next Verification Time"],
    "Notifications": ["Notification ID", "User ID", "Employee ID", "Title", "Message", "Type", "Read Status", "Created Date", "Link"],
    "Approval History": ["Approval ID", "Request ID", "Request Type", "Employee ID", "Requester ID", "Approver ID", "Action",
                         "Reason", "Action Date"],
    "Comp Off Ledger": ["Entry ID", "Employee ID", "Work Date", "Credit Days", "Status", "Used Request ID", "Created Date"],
    "Settings": ["Key", "Value", "Description"],
}

Row = dict[str, str]


class StoreError(Exception):
    """Raised when the workbook cannot be read or written."""


class ExcelStore:
    def __init__(self, path: Path):
        self.path = Path(path)
        self._tx_lock = threading.RLock()
        self._file_lock = FileLock(str(self.path) + ".lock", timeout=config.LOCK_TIMEOUT_SECONDS)
        self._data: dict[str, list[Row]] = {}
        self._mtime: float = 0.0
        self._dirty = False
        self._depth = 0
        self.initialised = False

    # ------------------------------------------------------------------ setup
    def initialise(self) -> bool:
        """Create the workbook/sheets if missing. Returns True when the file was newly created."""
        with self._tx_lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            created = not self.path.exists()
            with self._file_lock:
                if created:
                    self._data = {name: [] for name in SHEETS}
                    self._persist()
                else:
                    self._load()
                    missing = [s for s in SHEETS if s not in self._data]
                    if missing:
                        for s in missing:
                            self._data[s] = []
                        self._persist()
            self.initialised = True
            return created

    # ---------------------------------------------------------------- loading
    def _disk_mtime(self) -> float:
        try:
            return self.path.stat().st_mtime
        except FileNotFoundError:
            return 0.0

    def _load(self) -> None:
        try:
            frames = pd.read_excel(self.path, sheet_name=None, dtype=str, keep_default_na=False, engine="openpyxl")
        except Exception as exc:  # corrupt / locked / unreadable workbook
            raise StoreError(f"Unable to read the data file: {exc}") from exc
        data: dict[str, list[Row]] = {}
        for name, cols in SHEETS.items():
            df = frames.get(name)
            if df is None:
                data[name] = []
                continue
            for c in cols:
                if c not in df.columns:
                    df[c] = ""
            data[name] = [{c: str(r[c]) for c in cols} for r in df[cols].to_dict("records")]
        self._data = data
        self._mtime = self._disk_mtime()
        self._dirty = False

    def _refresh_if_changed(self) -> None:
        if self._depth == 0 and self._disk_mtime() != self._mtime:
            self._load()

    def _persist(self) -> None:
        """Validate and atomically write every sheet to disk."""
        for name, cols in SHEETS.items():
            for row in self._data.get(name, []):
                if set(row.keys()) != set(cols):
                    raise StoreError(f"Invalid row structure for sheet '{name}'")
        fd, tmp_name = tempfile.mkstemp(prefix=".attendance_", suffix=".xlsx", dir=str(self.path.parent))
        os.close(fd)
        try:
            with pd.ExcelWriter(tmp_name, engine="openpyxl") as writer:
                for name, cols in SHEETS.items():
                    df = pd.DataFrame(self._data.get(name, []), columns=cols)
                    df.to_excel(writer, sheet_name=name, index=False)
                    ws = writer.sheets[name]
                    for idx, col in enumerate(cols, start=1):
                        width = max([len(col)] + [len(str(r[col])) for r in self._data.get(name, [])[:200]]) + 2
                        ws.column_dimensions[ws.cell(row=1, column=idx).column_letter].width = min(width, 60)
            last_error: Exception | None = None
            for _ in range(10):  # the workbook may be briefly open in Excel / antivirus
                try:
                    os.replace(tmp_name, self.path)
                    last_error = None
                    break
                except PermissionError as exc:
                    last_error = exc
                    time.sleep(0.3)
            if last_error:
                raise StoreError("The data file is currently locked by another program. Close it and try again.")
        except StoreError:
            raise
        except Exception as exc:
            raise StoreError(f"Unable to write the data file: {exc}") from exc
        finally:
            if os.path.exists(tmp_name):
                try:
                    os.remove(tmp_name)
                except OSError:
                    pass
        self._mtime = self._disk_mtime()
        self._dirty = False

    # ---------------------------------------------------------------- reading
    def rows(self, sheet: str) -> list[Row]:
        with self._tx_lock:
            self._refresh_if_changed()
            return self._data[sheet]

    def find(self, sheet: str, **conds: str) -> list[Row]:
        return [r for r in self.rows(sheet) if all(r.get(k) == v for k, v in conds.items())]

    def get(self, sheet: str, key_col: str, key: str) -> Row | None:
        for r in self.rows(sheet):
            if r[key_col] == key:
                return r
        return None

    # ---------------------------------------------------------------- writing
    @contextmanager
    def transaction(self) -> Iterator["ExcelStore"]:
        with self._tx_lock:
            outer = self._depth == 0
            if outer:
                try:
                    self._file_lock.acquire()
                except Timeout as exc:
                    raise StoreError("The data file is busy. Please try again.") from exc
                if self._disk_mtime() != self._mtime:
                    self._load()
            self._depth += 1
            try:
                yield self
                if outer and self._dirty:
                    self._persist()
            except BaseException:
                if outer:
                    self._depth -= 1
                    try:
                        self._load()
                    finally:
                        self._file_lock.release()
                    raise
                self._depth -= 1
                raise
            else:
                self._depth -= 1
                if outer:
                    self._file_lock.release()

    def _require_tx(self) -> None:
        if self._depth == 0:
            raise StoreError("Writes must happen inside store.transaction()")

    def insert(self, sheet: str, row: Row) -> Row:
        self._require_tx()
        cols = SHEETS[sheet]
        clean = {c: str(row.get(c, "") if row.get(c, "") is not None else "") for c in cols}
        self._data[sheet].append(clean)
        self._dirty = True
        return clean

    def update(self, sheet: str, key_col: str, key: str, changes: dict) -> Row:
        self._require_tx()
        for r in self._data[sheet]:
            if r[key_col] == key:
                for k, v in changes.items():
                    if k not in r:
                        raise StoreError(f"Unknown column '{k}' in sheet '{sheet}'")
                    r[k] = "" if v is None else str(v)
                self._dirty = True
                return r
        raise StoreError(f"Record '{key}' not found in '{sheet}'")

    def next_id(self, sheet: str, key_col: str, prefix: str, width: int = 4) -> str:
        highest = 0
        for r in self.rows(sheet):
            v = r[key_col]
            if v.startswith(prefix) and v[len(prefix):].isdigit():
                highest = max(highest, int(v[len(prefix):]))
        return f"{prefix}{highest + 1:0{width}d}"


store = ExcelStore(config.DATA_FILE)
