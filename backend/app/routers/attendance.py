from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import ADMIN, HR, TEAM_LEAD, CurrentUser, get_current_user, require_roles
from app.services import attendance_service as att
from app.services import dashboard_service, report_service
from app.utils import timeutil

router = APIRouter(prefix="/attendance", tags=["Attendance"])


def _need_employee(user: CurrentUser) -> str:
    if not user["employee_id"]:
        raise HTTPException(400, "No employee profile is linked to this account")
    return user["employee_id"]


@router.post("/check-in", status_code=201)
def check_in(user: CurrentUser = Depends(get_current_user)):
    row = att.check_in(_need_employee(user))
    return {"message": "Check-In Successful!", "status": row["Status"], "check_in_time": row["Check-in Time"],
            "date": row["Date"], **att.punctuality(row["Check-in Time"])}


@router.get("/today")
def today(user: CurrentUser = Depends(get_current_user)):
    return att.today_state(_need_employee(user))


@router.get("/my")
def my_history(from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"), month: str = "",
               date: str = "", status: str = "", user: CurrentUser = Depends(get_current_user)):
    emp = _need_employee(user)
    try:
        if date:
            start = end = timeutil.parse_date(date)
        elif month:
            start = timeutil.parse_date(month + "-01")
            end = (start.replace(day=28) + timedelta(days=4)).replace(day=1) - timedelta(days=1)
        elif from_date and to_date:
            start, end = timeutil.parse_date(from_date), timeutil.parse_date(to_date)
        else:
            start, end = timeutil.today().replace(day=1), timeutil.today()
    except ValueError:
        raise HTTPException(422, "Invalid date filter")
    if start > end:
        raise HTTPException(422, "From date cannot be after To date")
    if (end - start).days > 366:
        raise HTTPException(422, "Date range is too large (max 366 days)")
    return att.history(emp, start, end, status)


@router.get("/overview")
def overview(from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"), employee_id: str = "",
             department: str = "", team_lead_id: str = "", status: str = "",
             user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    start, end = dashboard_service.resolve_range("custom", from_date, to_date) if from_date and to_date \
        else dashboard_service.resolve_range("today")
    _, rows = report_service.attendance_report(user, start, end, employee_id, department, status, team_lead_id)
    return [{"employee_id": r["Employee ID"], "employee_name": r["Employee"], "department": r["Department"],
             "date": r["Date"], "check_in_time": r["Check-in Time"], "status": r["Status"]} for r in rows]
