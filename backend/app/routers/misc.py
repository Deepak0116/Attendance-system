import logging
from datetime import timedelta

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials

from app.auth import report_key
from app.auth.deps import ADMIN, HR, TEAM_LEAD, CurrentUser, bearer, get_current_user, require_roles
from app.schemas.models import SettingsIn
from app.services import attendance_service as att
from app.services import comp_off_service, dashboard_service, directory, notifications, report_service, settings_service
from app.utils import timeutil
from app.utils.excel_store import store

notifications_router = APIRouter(prefix="/notifications", tags=["Notifications"])
dashboard_router = APIRouter(prefix="/dashboard", tags=["Dashboard"])
reports_router = APIRouter(prefix="/reports", tags=["Reports"])
settings_router = APIRouter(prefix="/settings", tags=["Settings"])
comp_off_router = APIRouter(prefix="/comp-off", tags=["Comp Off"])
report_key_router = APIRouter(prefix="/report-key", tags=["Reporting key"])
log = logging.getLogger("attendance.reports")


def report_principal(request: Request, creds: HTTPAuthorizationCredentials | None = Depends(bearer),
                     x_report_key: str | None = Header(default=None), key: str | None = Query(default=None)) -> CurrentUser:
    """HR/Admin with a normal login, or a read-only reporting key (header X-Report-Key, or ?key=)."""
    supplied = x_report_key or key
    if supplied:
        if not report_key.matches(supplied):
            raise HTTPException(401, "Invalid reporting key")
        log.info("Report fetched with the reporting key from %s: %s", request.client.host if request.client else "?", request.url.path)
        # role "Report" sees every employee but never precise WFH coordinates (those are HR/Admin only)
        return {"user_id": "", "username": "reporting-key", "role": "Report", "employee_id": "", "name": "Reporting key",
                "email": "", "department": "", "designation": "", "team_lead_id": ""}
    user = get_current_user(creds)
    if user["role"] not in (HR, ADMIN):
        raise HTTPException(403, "You do not have permission to perform this action")
    return user


def period_dates(period: str):
    today = timeutil.today()
    if period == "last_5_days":
        return today - timedelta(days=4), today
    if period == "this_week":
        start = today - timedelta(days=today.weekday())
    elif period == "last_week":
        start = today - timedelta(days=today.weekday() + 7)
    elif period in ("this_month", "last_month"):
        first = today.replace(day=1)
        if period == "last_month":
            first = (first - timedelta(days=1)).replace(day=1)
        nxt = (first + timedelta(days=32)).replace(day=1)
        return first, nxt - timedelta(days=1)
    else:
        raise HTTPException(422, "period must be last_5_days, this_week, last_week, this_month or last_month")
    return start, start + timedelta(days=6)


@report_key_router.get("")
def get_report_key(user: CurrentUser = Depends(require_roles(ADMIN))):
    return {"key": report_key.get_key(), "from_environment": report_key.from_env()}


@report_key_router.post("/rotate")
def rotate_report_key(user: CurrentUser = Depends(require_roles(ADMIN))):
    if report_key.from_env():
        raise HTTPException(409, "The key is set by the REPORT_API_KEY environment variable. Change it there.")
    return {"key": report_key.rotate(), "from_environment": False}


@comp_off_router.get("/my")
def my_comp_off(user: CurrentUser = Depends(get_current_user)):
    emp = user["employee_id"]
    return {"balance": comp_off_service.balance(emp), "available_to_request": comp_off_service.available_to_request(emp),
            "expiry_days": settings_service.get_int("comp_off_expiry_days"), "ledger": comp_off_service.ledger(emp)}


@comp_off_router.get("")
def comp_off_overview(employee_id: str = "", department: str = "", user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    """Credits earned/used. TLs only see their own team (enforced via the directory)."""
    ids = {e["employee_id"] for e in directory.visible_employees(user, employee_id=employee_id, department=department,
                                                                  include_inactive=True)}
    return comp_off_service.overview(lambda e: e["Employee ID"] in ids)


# -------------------------------------------------------------- notifications
@notifications_router.get("")
def list_notifications(user: CurrentUser = Depends(get_current_user)):
    mine = sorted((n for n in store.rows("Notifications") if n["User ID"] == user["user_id"]),
                  key=lambda n: n["Created Date"], reverse=True)
    return {"unread": sum(1 for n in mine if n["Read Status"] == "Unread"), "items": [notifications.to_dto(n) for n in mine[:50]]}


@notifications_router.post("/read-all")
def read_all(user: CurrentUser = Depends(get_current_user)):
    with store.transaction():
        for n in store.rows("Notifications"):
            if n["User ID"] == user["user_id"] and n["Read Status"] == "Unread":
                store.update("Notifications", "Notification ID", n["Notification ID"], {"Read Status": "Read"})
    return {"message": "All notifications marked as read"}


@notifications_router.post("/{notification_id}/read")
def read_one(notification_id: str, user: CurrentUser = Depends(get_current_user)):
    with store.transaction():
        n = store.get("Notifications", "Notification ID", notification_id)
        if not n or n["User ID"] != user["user_id"]:
            raise HTTPException(404, "Notification not found")
        store.update("Notifications", "Notification ID", notification_id, {"Read Status": "Read"})
    return {"message": "Marked as read"}


# ------------------------------------------------------------------ dashboard
@dashboard_router.get("/stats")
def stats(range: str = "today", from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"),
          employee_id: str = "", department: str = "", team_lead_id: str = "", user: CurrentUser = Depends(get_current_user)):
    if user["role"] == "Employee":
        return dashboard_service.employee_dashboard(user)
    return dashboard_service.overview(user, range, from_date, to_date, employee_id, department, team_lead_id)


@dashboard_router.get("/me")
def my_dashboard(user: CurrentUser = Depends(get_current_user)):
    """Personal summary for any role that has an employee profile (used by the check-in / WFH panels)."""
    return dashboard_service.employee_dashboard(user)


# -------------------------------------------------------------------- reports
@reports_router.get("/{kind}")
def report(kind: str, format: str = "json", from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"),
           period: str = "", employee_id: str = "", department: str = "", status: str = "", leave_type: str = "",
           team_lead_id: str = "", user: CurrentUser = Depends(report_principal)):
    if kind not in ("attendance", "leave", "wfh", "summary"):
        raise HTTPException(404, "Unknown report")
    if format not in ("json", "csv", "xlsx"):
        raise HTTPException(422, "format must be json, csv or xlsx")
    if period and not (from_date and to_date):
        start, end = period_dates(period)  # handy for Power BI: ?period=last_month needs no date maths
    elif from_date and to_date:
        start, end = dashboard_service.resolve_range("custom", from_date, to_date)
    else:
        start, end = dashboard_service.resolve_range("month")
    if kind == "summary":
        cols, rows = report_service.summary_report(user, start, end, employee_id, department, team_lead_id)
    elif kind == "attendance":
        cols, rows = report_service.attendance_report(user, start, end, employee_id, department, status, team_lead_id)
    elif kind == "leave":
        cols, rows = report_service.leave_report(user, start, end, employee_id, department, status, leave_type)
    else:
        cols, rows = report_service.wfh_report(user, start, end, employee_id, department, status, team_lead_id)
    totals = report_service.summary_totals(rows) if kind == "summary" else None
    if format == "json":
        return {"columns": cols, "rows": rows, "totals": totals}
    if totals:
        rows = rows + [totals]
    name = f"{kind}_report_{start.isoformat()}_{end.isoformat()}"
    if format == "csv":
        return Response(report_service.to_csv(cols, rows), media_type="text/csv",
                        headers={"Content-Disposition": f'attachment; filename="{name}.csv"'})
    return Response(report_service.to_xlsx(cols, rows, f"{kind.title()} Report"),
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{name}.xlsx"'})


# ------------------------------------------------------------------- settings
@settings_router.get("")
def get_settings(user: CurrentUser = Depends(require_roles(HR, ADMIN))):
    return settings_service.all_settings()


@settings_router.put("")
def update_settings(body: SettingsIn, user: CurrentUser = Depends(require_roles(ADMIN))):
    numeric = {"wfh_verification_interval_hours": (1, 12), "wfh_missed_grace_minutes": (5, 480),
               "location_retention_days": (0, 3650), "comp_off_expiry_days": (0, 3650),
               "late_grace_minutes": (0, 180), "early_checkin_minutes": (0, 240),
               "leave_allowance_per_month": (0, 31)}
    booleans = ("hr_override_enabled", "admin_override_enabled")
    for k, v in body.settings.items():
        if k not in settings_service.DEFAULT_SETTINGS:
            raise HTTPException(422, f"Unknown setting '{k}'")
        if k in numeric:
            try:
                n = int(v)
            except ValueError:
                raise HTTPException(422, f"{k} must be a whole number")
            if not numeric[k][0] <= n <= numeric[k][1]:
                raise HTTPException(422, f"{k} must be between {numeric[k][0]} and {numeric[k][1]}")
        if k in booleans and v.lower() not in ("true", "false"):
            raise HTTPException(422, f"{k} must be true or false")
        if k == "office_start_time":
            try:
                hh, mm = (int(x) for x in v.split(":"))
                assert 0 <= hh < 24 and 0 <= mm < 60
            except (ValueError, AssertionError):
                raise HTTPException(422, "office_start_time must look like 09:30 (24-hour HH:MM)")
        if k == "holiday_saturdays":
            parts = [x.strip() for x in v.replace(";", ",").split(",") if x.strip()]
            if any(not x.isdigit() or not 1 <= int(x) <= 5 for x in parts):
                raise HTTPException(422, "holiday_saturdays must be numbers 1-5, e.g. 2,4 for the second and fourth Saturday")
        if k == "working_days":
            days = [d.strip()[:3].title() for d in v.split(",") if d.strip()]
            if not days or any(d not in settings_service.DAY_INDEX for d in days):
                raise HTTPException(422, "working_days must be a comma separated list such as Mon,Tue,Wed")
    with store.transaction():
        for k, v in body.settings.items():
            store.update("Settings", "Key", k, {"Value": v.strip()})
    return settings_service.all_settings()
