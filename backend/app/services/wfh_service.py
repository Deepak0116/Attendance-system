"""WFH start, periodic location verification and status calculation.

Location is only ever captured when the employee explicitly triggers START WFH or
VERIFY LOCATION. Nothing here tracks movement or reads location in the background.
"""
from datetime import date, datetime, timedelta

from fastapi import HTTPException

from app.auth.deps import ADMIN, HR, CurrentUser
from app.services import attendance_service, comp_off_service, directory, notifications, settings_service
from app.utils import timeutil
from app.utils.excel_store import store

ACTIVE, VERIFIED, DUE, PENDING, MISSED, COMPLETED = (
    "Active", "Verified", "Verification Due", "Pending Verification", "Missed Verification", "Completed")
START, PERIODIC, END = "Start", "Verification", "End"


def _validate_coords(lat: float, lon: float) -> None:
    if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
        raise HTTPException(422, "Invalid location coordinates.")


def interval() -> timedelta:
    return timedelta(hours=settings_service.get_int("wfh_verification_interval_hours"))


def _day_rows(employee_id: str, d: str) -> list[dict]:
    return sorted((v for v in store.rows("WFH Verifications") if v["Employee ID"] == employee_id and v["Date"] == d),
                  key=lambda v: v["Verification Time"])


def compute_status(rows: list[dict], d: date, now: datetime) -> dict:
    """Derive the session state from the verification rows of one employee-day."""
    starts = [r for r in rows if r["Verification Type"] == START]
    ended = any(r["Verification Type"] == END for r in rows)
    located = [r for r in rows if r["Verification Type"] in (START, PERIODIC)]
    if not starts:
        status = PENDING if d >= now.date() else MISSED
        return {"started": False, "ended": False, "status": status, "start_time": "", "last_verification": "",
                "next_verification": "", "count": 0}
    last = located[-1]
    next_at = timeutil.parse_dt(last["Next Verification Time"]) if last["Next Verification Time"] else None
    grace = timedelta(minutes=settings_service.get_int("wfh_missed_grace_minutes"))
    if ended or d < now.date():
        status = COMPLETED
    elif next_at and now > next_at + grace:
        status = MISSED
    elif next_at and now >= next_at:
        status = DUE
    else:
        status = VERIFIED
    return {"started": True, "ended": ended, "status": status, "start_time": starts[0]["Verification Time"],
            "last_verification": last["Verification Time"], "next_verification": "" if ended else last["Next Verification Time"],
            "count": len(located)}


def approved_request_for(employee_id: str, d: date) -> dict | None:
    """The approved WFH request for this day - unless the person is on approved leave that day (leave wins)."""
    if attendance_service.has_approved("Leave Requests", employee_id, d):
        return None
    for r in store.rows("WFH Requests"):
        if r["Employee ID"] == employee_id and r["Status"] == "Approved" and \
                timeutil.parse_date(r["From Date"]) <= d <= timeutil.parse_date(r["To Date"]):
            return r
    return None


def my_today(user: CurrentUser) -> dict:
    now, today = timeutil.now(), timeutil.today()
    req = approved_request_for(user["employee_id"], today)
    base = {"approved": bool(req), "request_id": req["Request ID"] if req else "", "date": today.isoformat(),
            "server_now": timeutil.fmt_dt(now), "interval_hours": settings_service.get_int("wfh_verification_interval_hours")}
    if not req:
        return {**base, "started": False, "ended": False, "status": "", "start_time": "", "last_verification": "",
                "next_verification": "", "count": 0}
    return {**base, **compute_status(_day_rows(user["employee_id"], today.isoformat()), today, now)}


def _add_verification(employee_id: str, req_id: str, vtype: str, lat: float | None, lon: float | None,
                      status: str, next_at: datetime | None, now: datetime) -> dict:
    return store.insert("WFH Verifications", {
        "Verification ID": store.next_id("WFH Verifications", "Verification ID", "WV", 6), "Employee ID": employee_id,
        "WFH Request ID": req_id, "Date": now.date().isoformat(), "Verification Type": vtype,
        "Verification Time": timeutil.fmt_dt(now), "Latitude": "" if lat is None else f"{lat:.6f}",
        "Longitude": "" if lon is None else f"{lon:.6f}", "Location Status": status,
        "Next Verification Time": timeutil.fmt_dt(next_at) if next_at else ""})


def start(user: CurrentUser, lat: float, lon: float) -> dict:
    _validate_coords(lat, lon)
    now, today = timeutil.now(), timeutil.today()
    emp = user["employee_id"]
    with store.transaction():
        req = approved_request_for(emp, today)
        if not req:
            raise HTTPException(400, "You do not have an approved WFH request for today.")
        if _day_rows(emp, today.isoformat()):
            raise HTTPException(409, "Your WFH has already been started today.")
        if any(a["Employee ID"] == emp and a["Date"] == today.isoformat() for a in store.rows("Attendance")):
            raise HTTPException(409, "You have already checked in today.")
        _add_verification(emp, req["Request ID"], START, lat, lon, "Verified", now + interval(), now)
        store.insert("Attendance", {
            "Attendance ID": store.next_id("Attendance", "Attendance ID", "ATT", 6), "Employee ID": emp,
            "Date": today.isoformat(), "Check-in Time": timeutil.fmt_dt(now), "Status": attendance_service.WFH})
        comp_off_service.award_if_off_day(emp, today)
    return my_today(user)


def verify(user: CurrentUser, lat: float, lon: float) -> dict:
    _validate_coords(lat, lon)
    now, today = timeutil.now(), timeutil.today()
    emp = user["employee_id"]
    with store.transaction():
        req = approved_request_for(emp, today)
        if not req:
            raise HTTPException(400, "Location verification is only available on an approved WFH day.")
        rows = _day_rows(emp, today.isoformat())
        state = compute_status(rows, today, now)
        if not state["started"]:
            raise HTTPException(400, "Start your WFH before verifying your location.")
        if state["ended"]:
            raise HTTPException(409, "Your WFH has already been completed for today.")
        _add_verification(emp, req["Request ID"], PERIODIC, lat, lon, "Verified", now + interval(), now)
    return my_today(user)


def end(user: CurrentUser) -> dict:
    now, today = timeutil.now(), timeutil.today()
    emp = user["employee_id"]
    with store.transaction():
        req = approved_request_for(emp, today)
        rows = _day_rows(emp, today.isoformat())
        state = compute_status(rows, today, now)
        if not req or not state["started"]:
            raise HTTPException(400, "There is no active WFH session to complete.")
        if state["ended"]:
            raise HTTPException(409, "Your WFH has already been completed for today.")
        _add_verification(emp, req["Request ID"], END, None, None, "Completed", None, now)
    return my_today(user)


def sessions(user: CurrentUser, start_d: date, end_d: date, *, employee_id: str = "", department: str = "",
             team_lead_id: str = "", status: str = "") -> list[dict]:
    """One row per (employee, approved WFH day). TL sees own team only; coordinates only for HR/Admin."""
    now = timeutil.now()
    show_location = user["role"] in (HR, ADMIN)
    emps = directory.visible_employees(user, employee_id=employee_id, department=department, team_lead_id=team_lead_id)
    wfh_spans: dict[str, list[tuple[date, date, str]]] = {}
    for r in store.rows("WFH Requests"):
        if r["Status"] == "Approved":
            wfh_spans.setdefault(r["Employee ID"], []).append(
                (timeutil.parse_date(r["From Date"]), timeutil.parse_date(r["To Date"]), r["Request ID"]))
    leave_spans = attendance_service._approved_spans("Leave Requests")
    by_key: dict[tuple[str, str], list[dict]] = {}
    for v in store.rows("WFH Verifications"):
        by_key.setdefault((v["Employee ID"], v["Date"]), []).append(v)
    out = []
    for e in emps:
        for d in timeutil.daterange(start_d, min(end_d, timeutil.today())):
            span = next((s for s in wfh_spans.get(e["employee_id"], []) if s[0] <= d <= s[1]), None)
            if not span or attendance_service._covers(leave_spans.get(e["employee_id"]), d):
                continue  # no WFH on a day the person is on approved leave
            rows = sorted(by_key.get((e["employee_id"], d.isoformat()), []), key=lambda v: v["Verification Time"])
            st = compute_status(rows, d, now)
            if status and st["status"] != status:
                continue
            located = [r for r in rows if r["Verification Type"] in (START, PERIODIC)]
            item = {"employee_id": e["employee_id"], "employee_name": e["name"], "department": e["department"],
                    "team_lead_name": e["team_lead_name"], "date": d.isoformat(), "request_id": span[2],
                    "start_time": st["start_time"], "last_verification": st["last_verification"],
                    "next_verification": st["next_verification"], "status": st["status"], "verifications": st["count"]}
            if show_location:
                last = located[-1] if located else None
                item["latitude"] = last["Latitude"] if last else ""
                item["longitude"] = last["Longitude"] if last else ""
            out.append(item)
    return sorted(out, key=lambda x: (x["date"], x["employee_name"]), reverse=True)


def stats(items: list[dict]) -> dict:
    count = lambda s: sum(1 for i in items if i["status"] == s)
    return {"total": len(items), "verified": count(VERIFIED) + count(COMPLETED), "pending": count(PENDING),
            "due": count(DUE), "missed": count(MISSED)}


def verification_history(user: CurrentUser, employee_id: str, d: str) -> list[dict]:
    directory.assert_can_view_employee(user, employee_id)
    show_location = user["role"] in (HR, ADMIN)
    out = []
    for v in _day_rows(employee_id, d):
        item = {"id": v["Verification ID"], "type": v["Verification Type"], "time": v["Verification Time"],
                "location_status": v["Location Status"], "next_verification": v["Next Verification Time"]}
        if show_location:
            item["latitude"], item["longitude"] = v["Latitude"], v["Longitude"]
        out.append(item)
    return out


def sweep() -> None:
    """Create 'due' reminders and 'missed' alerts for today's active sessions, and erase expired coordinates."""
    now, today = timeutil.now(), timeutil.today()
    with store.transaction():
        approved = {r["Employee ID"] for r in store.rows("WFH Requests")
                    if r["Status"] == "Approved" and timeutil.parse_date(r["From Date"]) <= today <= timeutil.parse_date(r["To Date"])}
        names = {e["employee_id"]: e["name"] for e in directory.enrich_all()}
        for emp in approved:
            rows = _day_rows(emp, today.isoformat())
            st = compute_status(rows, today, now)
            if not st["started"] or st["ended"]:
                continue
            key = f"{emp}-{st['next_verification']}"
            if st["status"] == DUE:
                notifications.notify_employee(
                    emp, "WFH Verification Required!", "Please verify your location again.", "wfh_verification_due", key, link="/wfh")
            elif st["status"] == MISSED:
                notifications.notify_admins(
                    "Missed WFH Verification", f"{names.get(emp, emp)} missed the WFH verification due at "
                    f"{timeutil.parse_dt(st['next_verification']).strftime('%I:%M %p')}.", "wfh_missed", key, link="/wfh-overview")
                tl_id = (store.get("Employees", "Employee ID", emp) or {}).get("Team Lead ID", "")
                notifications.notify_employee(
                    tl_id, "Missed WFH Verification", f"{names.get(emp, emp)} missed a WFH verification.",
                    "wfh_missed", key, link="/wfh-tracking")
    purge_expired_locations()


def purge_expired_locations() -> int:
    days = settings_service.get_int("location_retention_days")
    if days <= 0:
        return 0
    cutoff = (timeutil.today() - timedelta(days=days)).isoformat()
    purged = 0
    with store.transaction():
        for v in store.rows("WFH Verifications"):
            if v["Date"] < cutoff and (v["Latitude"] or v["Longitude"]):
                store.update("WFH Verifications", "Verification ID", v["Verification ID"],
                             {"Latitude": "", "Longitude": "", "Location Status": "Purged"})
                purged += 1
    return purged
