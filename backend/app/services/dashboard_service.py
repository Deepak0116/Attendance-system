from datetime import date, timedelta

from fastapi import HTTPException

from app.auth.deps import ADMIN, EMPLOYEE, HR, TEAM_LEAD, CurrentUser
from app.services import attendance_service as att
from app.services import comp_off_service, directory, request_service, wfh_service
from app.utils import timeutil
from app.utils.excel_store import store

MAX_RANGE_DAYS = 366


def resolve_range(range_name: str = "today", from_date: str = "", to_date: str = "") -> tuple[date, date]:
    today = timeutil.today()
    if range_name == "today":
        return today, today
    if range_name == "yesterday":
        y = today - timedelta(days=1)
        return y, y
    if range_name == "last5":
        return today - timedelta(days=4), today
    if range_name == "week":
        return today - timedelta(days=today.weekday()), today
    if range_name == "month":
        return today.replace(day=1), today
    if range_name == "custom":
        try:
            a, b = timeutil.parse_date(from_date), timeutil.parse_date(to_date)
        except ValueError:
            raise HTTPException(422, "Custom range requires valid from and to dates (YYYY-MM-DD).")
        if a > b:
            raise HTTPException(422, "From date cannot be after To date.")
        if (b - a).days > MAX_RANGE_DAYS:
            raise HTTPException(422, "Date range is too large (max 366 days).")
        return a, b
    raise HTTPException(422, "Invalid range. Use today, yesterday, last5, week, month or custom.")


def status_matrix(emps: list[dict], start: date, end: date):
    """Yield (employee, date, status) for every resolvable day up to today."""
    res = att.DayResolver()
    last = min(end, timeutil.today())
    for e in emps:
        for d in timeutil.daterange(start, last):
            s = res.status(e["employee_id"], d)
            if s is not None:
                yield e, d, s


def requests_in_scope(user: CurrentUser, kind: str, emp_ids: set[str] | None = None) -> list[dict]:
    if user["role"] == TEAM_LEAD:
        team = directory.team_member_ids(user["employee_id"])
        return request_service.list_requests(kind, lambda r: r["Employee ID"] in team)
    if emp_ids is not None:
        return request_service.list_requests(kind, lambda r: r["Employee ID"] in emp_ids)
    return request_service.list_requests(kind)


def employee_dashboard(user: CurrentUser) -> dict:
    today = timeutil.today()
    start = today.replace(day=1)
    nxt = (start + timedelta(days=32)).replace(day=1)
    summary = att.month_summary(user["employee_id"], start, nxt - timedelta(days=1))
    summary["comp_off_balance"] = comp_off_service.available_to_request(user["employee_id"])
    return {"role": user["role"], "summary": summary, "today": att.today_state(user["employee_id"]),
            "wfh": wfh_service.my_today(user),
            "pending_requests": sum(1 for kind in (request_service.LEAVE, request_service.WFH)
                                    for r in store.rows(request_service.SHEET[kind])
                                    if r["Employee ID"] == user["employee_id"] and r["Status"].startswith("Pending"))}


def overview(user: CurrentUser, range_name: str, from_date: str, to_date: str, employee_id: str = "",
             department: str = "", team_lead_id: str = "") -> dict:
    if user["role"] not in (TEAM_LEAD, HR, ADMIN):
        raise HTTPException(403, "You do not have permission to view this dashboard.")
    start, end = resolve_range(range_name, from_date, to_date)
    emps = directory.visible_employees(user, employee_id=employee_id, department=department,
                                       team_lead_id=team_lead_id, exclude_admin=True)
    counts = {att.PRESENT: 0, att.LEAVE: 0, att.WFH: 0, att.NOT_CHECKED_IN: 0}
    trend: dict[str, dict] = {}
    dept: dict[str, dict] = {}
    for e, d, s in status_matrix(emps, start, end):
        counts[s] += 1
        t = trend.setdefault(d.isoformat(), {"date": d.isoformat(), "present": 0, "leave": 0, "wfh": 0, "not_checked_in": 0})
        key = {att.PRESENT: "present", att.LEAVE: "leave", att.WFH: "wfh", att.NOT_CHECKED_IN: "not_checked_in"}[s]
        t[key] += 1
        dp = dept.setdefault(e["department"] or "Unassigned", {"department": e["department"] or "Unassigned", "employees": 0,
                                                              "present": 0, "leave": 0, "wfh": 0, "not_checked_in": 0})
        dp[key] += 1
    for e in emps:
        dept.setdefault(e["department"] or "Unassigned", {"department": e["department"] or "Unassigned", "employees": 0,
                                                         "present": 0, "leave": 0, "wfh": 0, "not_checked_in": 0})["employees"] += 1
    ids = {e["employee_id"] for e in emps}
    pending = request_service.pending_for(user)
    if user["role"] == HR:
        # HR's own queue is TL requests; the headline "Pending Requests" for HR is every unresolved request.
        pending_all = sum(1 for k in (request_service.LEAVE, request_service.WFH) for r in store.rows(request_service.SHEET[k])
                          if r["Status"].startswith("Pending"))
    else:
        pending_all = len(pending)
    recent = sorted(requests_in_scope(user, request_service.LEAVE, ids if user["role"] != TEAM_LEAD else None) +
                    requests_in_scope(user, request_service.WFH, ids if user["role"] != TEAM_LEAD else None),
                    key=lambda r: r["created"], reverse=True)[:8]
    wfh_items = wfh_service.sessions(user, start, end, employee_id=employee_id, department=department, team_lead_id=team_lead_id)
    result = {
        "role": user["role"], "range": {"from": start.isoformat(), "to": end.isoformat(), "days": (end - start).days + 1},
        "total_employees": len(emps), "present": counts[att.PRESENT], "on_leave": counts[att.LEAVE], "wfh": counts[att.WFH],
        "not_checked_in": counts[att.NOT_CHECKED_IN], "pending_approvals": pending_all,
        "trend": [trend[k] for k in sorted(trend)], "recent_requests": recent,
        "pending_requests": pending[:8], "wfh_stats": wfh_service.stats(wfh_items),
        "wfh_sessions": wfh_items[:8],
    }
    if user["role"] in (HR, ADMIN):
        result["departments"] = sorted(dept.values(), key=lambda x: x["department"])
    if user["role"] == ADMIN:
        result["recent_activities"] = recent_activities()
    return result


def recent_activities(limit: int = 10) -> list[dict]:
    names = {e["employee_id"]: e["name"] for e in directory.enrich_all()}
    items = []
    for a in store.rows("Approval History"):
        items.append({"time": a["Action Date"], "text": f"{names.get(a['Approver ID'], a['Approver ID'])} {a['Action'].lower()} "
                                                       f"{a['Request Type']} request of {names.get(a['Requester ID'], a['Requester ID'])}"})
    for a in store.rows("Attendance"):
        items.append({"time": a["Check-in Time"], "text": f"{names.get(a['Employee ID'], a['Employee ID'])} "
                                                         f"{'started WFH' if a['Status'] == att.WFH else 'checked in'}"})
    for v in store.rows("WFH Verifications"):
        if v["Verification Type"] == wfh_service.PERIODIC:
            items.append({"time": v["Verification Time"], "text": f"{names.get(v['Employee ID'], v['Employee ID'])} verified WFH location"})
    return sorted(items, key=lambda i: i["time"], reverse=True)[:limit]
