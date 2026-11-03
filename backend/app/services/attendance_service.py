"""Attendance rules and the per-day status resolver shared by dashboards, history and reports."""
from datetime import date

from fastapi import HTTPException

from app.services import comp_off_service, settings_service
from app.utils import timeutil
from app.utils.excel_store import store

PRESENT, LEAVE, WFH, NOT_CHECKED_IN = "Present", "Leave", "WFH", "Not Checked In"
APPROVED = "Approved"


def _approved_spans(sheet: str) -> dict[str, list[tuple[date, date]]]:
    spans: dict[str, list[tuple[date, date]]] = {}
    for r in store.rows(sheet):
        if r["Status"] == APPROVED:
            spans.setdefault(r["Employee ID"], []).append((timeutil.parse_date(r["From Date"]), timeutil.parse_date(r["To Date"])))
    return spans


def _covers(spans: list[tuple[date, date]] | None, d: date) -> bool:
    return any(a <= d <= b for a, b in (spans or []))


def has_approved(sheet: str, employee_id: str, d: date) -> bool:
    return _covers(_approved_spans(sheet).get(employee_id), d)


class DayResolver:
    """Builds lookups once, then resolves (employee, date) -> status quickly."""

    def __init__(self) -> None:
        self.att = {(r["Employee ID"], r["Date"]): r for r in store.rows("Attendance")}
        self.leave = _approved_spans("Leave Requests")
        self.wfh = _approved_spans("WFH Requests")
        self.default_days = settings_service.working_weekdays()
        self.holiday_sats = settings_service.holiday_saturdays()
        dept_days = settings_service.department_weekdays()
        # only employees whose department has its own schedule (e.g. Support = 7 days)
        self.emp_days = {e["Employee ID"]: dept_days[e["Department"]] for e in store.rows("Employees") if e["Department"] in dept_days}

    def is_working_day(self, d: date, employee_id: str = "") -> bool:
        """Department schedule if it has one, else the company week minus holiday Saturdays (2nd/4th by default)."""
        own = self.emp_days.get(employee_id)
        if own is not None:
            return d.weekday() in own
        if d.weekday() not in self.default_days:
            return False
        return not (d.weekday() == 5 and settings_service.nth_weekday_of_month(d) in self.holiday_sats)

    def check_in(self, employee_id: str, d: date) -> str:
        r = self.att.get((employee_id, d.isoformat()))
        return r["Check-in Time"] if r else ""

    def status(self, employee_id: str, d: date) -> str | None:
        """None means a non-working day with no activity."""
        r = self.att.get((employee_id, d.isoformat()))
        if r:
            return r["Status"]
        if _covers(self.leave.get(employee_id), d):
            return LEAVE
        if _covers(self.wfh.get(employee_id), d):
            return WFH
        if not self.is_working_day(d, employee_id):
            return None
        return NOT_CHECKED_IN


def check_in(employee_id: str) -> dict:
    """Manual check-in. Validated server-side; atomic thanks to the store transaction."""
    today = timeutil.today()
    with store.transaction():
        existing = [r for r in store.rows("Attendance") if r["Employee ID"] == employee_id and r["Date"] == today.isoformat()]
        if existing:
            raise HTTPException(409, f"You have already checked in today at {_pretty(existing[0]['Check-in Time'])}.")
        if has_approved("Leave Requests", employee_id, today):
            raise HTTPException(400, "You are on approved leave today and cannot check in.")
        if has_approved("WFH Requests", employee_id, today):
            raise HTTPException(400, "Your WFH is approved for today. Please use START WFH to begin your day.")
        if not DayResolver().is_working_day(today, employee_id):
            raise HTTPException(400, "Today is not a working day.")
        now = timeutil.now()
        row = store.insert("Attendance", {
            "Attendance ID": store.next_id("Attendance", "Attendance ID", "ATT", 6), "Employee ID": employee_id,
            "Date": today.isoformat(), "Check-in Time": timeutil.fmt_dt(now), "Status": PRESENT})
        comp_off_service.award_if_off_day(employee_id, today)
    return row


def punctuality(ts: str) -> dict:
    """Early / on-time / late classification of a check-in time, used only for the friendly message."""
    if not ts:
        return {"punctuality": "", "minutes_early": 0, "minutes_late": 0}
    t = timeutil.parse_dt(ts)
    diff = t.hour * 60 + t.minute - settings_service.office_start_minutes()  # >0 = after start
    if diff <= -settings_service.get_int("early_checkin_minutes"):
        kind = "early"
    elif diff > settings_service.get_int("late_grace_minutes"):
        kind = "late"
    else:
        kind = "on_time"
    return {"punctuality": kind, "minutes_early": max(0, -diff), "minutes_late": max(0, diff)}


def _pretty(ts: str) -> str:
    return timeutil.parse_dt(ts).strftime("%I:%M %p")


def today_state(employee_id: str) -> dict:
    today = timeutil.today()
    res = DayResolver()
    rec = res.att.get((employee_id, today.isoformat()))
    status = res.status(employee_id, today)
    return {
        "date": today.isoformat(), "status": status or "Non-working day", "check_in_time": rec["Check-in Time"] if rec else "",
        "checked_in": bool(rec), **punctuality(rec["Check-in Time"] if rec else ""),
        "arrival": punctuality(timeutil.now_str())["punctuality"],  # wording for "you've just arrived" (start-up popup)
        "on_leave": status == LEAVE,
        "wfh_approved": status != LEAVE and has_approved("WFH Requests", employee_id, today),
        "working_day": res.is_working_day(today, employee_id),
        "comp_off_earned": any(e["Employee ID"] == employee_id and e["Work Date"] == today.isoformat() for e in store.rows("Comp Off Ledger")),
    }


def history(employee_id: str, start: date, end: date, status_filter: str = "") -> list[dict]:
    res = DayResolver()
    out = []
    for d in reversed(list(timeutil.daterange(start, min(end, timeutil.today())))):
        st = res.status(employee_id, d)
        if st is None or (status_filter and st != status_filter):
            continue
        out.append({"date": d.isoformat(), "check_in_time": res.check_in(employee_id, d), "status": st})
    return out


def month_summary(employee_id: str, start: date, end: date) -> dict:
    res = DayResolver()
    counts = {PRESENT: 0, LEAVE: 0, WFH: 0, NOT_CHECKED_IN: 0}
    total_working = 0
    for d in timeutil.daterange(start, end):
        if res.is_working_day(d, employee_id):
            total_working += 1
        st = res.status(employee_id, d)
        if st and d <= timeutil.today() and (st != NOT_CHECKED_IN or d < timeutil.today()):
            counts[st] += 1
    return {"present_days": counts[PRESENT], "leave_days": counts[LEAVE], "wfh_days": counts[WFH],
            "absent_days": counts[NOT_CHECKED_IN], "total_working_days": total_working}
