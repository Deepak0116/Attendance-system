"""Compensatory-off credits.

A credit is earned automatically when an employee works (checks in / starts WFH) on a weekly-off day of the
standard company week - e.g. the Support team, whose department works 7 days. Credits are redeemed through a
leave request of type "Comp Off" and are consumed (oldest first) when that request is approved.
"""
from datetime import date, timedelta

from fastapi import HTTPException

from app.services import directory, settings_service
from app.utils import timeutil
from app.utils.excel_store import store

COMP_OFF_TYPE = "Comp Off"
AVAILABLE, USED = "Available", "Used"


def works_on(employee_id: str, d: date) -> bool:
    """Does this employee normally work on ``d``? Department schedule if any, else company week minus holiday Saturdays."""
    emp = store.get("Employees", "Employee ID", employee_id)
    own = settings_service.department_weekdays().get(emp["Department"]) if emp else None
    if own:
        return d.weekday() in own
    return settings_service.is_company_working_day(d)


def award_if_off_day(employee_id: str, d: date) -> bool:
    """Call inside a transaction right after attendance is recorded for ``d``."""
    if settings_service.is_company_working_day(d):
        return False  # ordinary working day (holiday Saturdays and Sundays are off)
    if not works_on(employee_id, d):
        return False  # not this employee's working day either
    if any(e["Employee ID"] == employee_id and e["Work Date"] == d.isoformat() for e in store.rows("Comp Off Ledger")):
        return False
    store.insert("Comp Off Ledger", {
        "Entry ID": store.next_id("Comp Off Ledger", "Entry ID", "CO", 5), "Employee ID": employee_id,
        "Work Date": d.isoformat(), "Credit Days": "1", "Status": AVAILABLE, "Used Request ID": "",
        "Created Date": timeutil.now_str()})
    return True


def _expired(entry: dict) -> bool:
    days = settings_service.get_int("comp_off_expiry_days")
    return days > 0 and timeutil.parse_date(entry["Work Date"]) + timedelta(days=days) < timeutil.today()


def usable_entries(employee_id: str) -> list[dict]:
    rows = [e for e in store.rows("Comp Off Ledger")
            if e["Employee ID"] == employee_id and e["Status"] == AVAILABLE and not _expired(e)]
    return sorted(rows, key=lambda e: e["Work Date"])


def reserved_days(employee_id: str, exclude_request: str = "") -> int:
    """Days already requested in other pending Comp Off leave requests."""
    total = 0
    for r in store.rows("Leave Requests"):
        if r["Employee ID"] == employee_id and r["Leave Type"] == COMP_OFF_TYPE and r["Status"].startswith("Pending") \
                and r["Request ID"] != exclude_request:
            total += count_days(employee_id, timeutil.parse_date(r["From Date"]), timeutil.parse_date(r["To Date"]))
    return total


def balance(employee_id: str) -> int:
    return len(usable_entries(employee_id))


def available_to_request(employee_id: str) -> int:
    return max(0, balance(employee_id) - reserved_days(employee_id))


def count_days(employee_id: str, a: date, b: date) -> int:
    return sum(1 for d in timeutil.daterange(a, b) if works_on(employee_id, d))


def validate_request(employee_id: str, a: date, b: date) -> int:
    needed = count_days(employee_id, a, b)
    if needed == 0:
        raise HTTPException(422, "The selected dates contain no working days.")
    have = available_to_request(employee_id)
    if needed > have:
        raise HTTPException(409, f"Not enough comp-off balance. You need {needed} day(s) but have {have} available.")
    return needed


def consume_on_approval(employee_id: str, request: dict) -> None:
    """Mark the oldest credits as used for an approved Comp Off request (inside a transaction)."""
    needed = count_days(employee_id, timeutil.parse_date(request["From Date"]), timeutil.parse_date(request["To Date"]))
    entries = usable_entries(employee_id)
    if len(entries) < needed:
        raise HTTPException(409, "The employee no longer has enough comp-off balance for this request.")
    for e in entries[:needed]:
        store.update("Comp Off Ledger", "Entry ID", e["Entry ID"], {"Status": USED, "Used Request ID": request["Request ID"]})


def ledger(employee_id: str) -> list[dict]:
    out = []
    for e in sorted(store.rows("Comp Off Ledger"), key=lambda x: x["Work Date"], reverse=True):
        if e["Employee ID"] != employee_id:
            continue
        expired = e["Status"] == AVAILABLE and _expired(e)
        out.append({"id": e["Entry ID"], "work_date": e["Work Date"], "credit": int(e["Credit Days"] or 1),
                    "status": "Expired" if expired else e["Status"], "used_request_id": e["Used Request ID"]})
    return out


def overview(rows_filter=None) -> list[dict]:
    names = {e["employee_id"]: e for e in directory.enrich_all()}
    out = []
    for e in sorted(store.rows("Comp Off Ledger"), key=lambda x: x["Work Date"], reverse=True):
        if rows_filter and not rows_filter(e):
            continue
        emp = names.get(e["Employee ID"], {})
        expired = e["Status"] == AVAILABLE and _expired(e)
        out.append({"id": e["Entry ID"], "employee_id": e["Employee ID"], "employee_name": emp.get("name", ""),
                    "department": emp.get("department", ""), "work_date": e["Work Date"],
                    "status": "Expired" if expired else e["Status"], "used_request_id": e["Used Request ID"]})
    return out
