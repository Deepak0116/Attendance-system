from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import ADMIN, EMPLOYEE, HR, TEAM_LEAD, CurrentUser, get_current_user, require_roles
from app.schemas.models import LeaveIn, RejectIn, WfhIn
from app.services import dashboard_service, directory, request_service as rs
from app.utils import timeutil
from app.utils.excel_store import store

leave_router = APIRouter(prefix="/leave", tags=["Leave"])
wfh_router = APIRouter(prefix="/wfh", tags=["WFH Requests"])
requests_router = APIRouter(prefix="/requests", tags=["Requests"])


def _overview(kind: str, user: CurrentUser, from_date, to_date, status, employee_id, department, leave_type, team_lead_id):
    emp_ids = {e["employee_id"] for e in directory.visible_employees(
        user, employee_id=employee_id, department=department, team_lead_id=team_lead_id, include_inactive=True)}
    start = end = None
    if from_date and to_date:
        start, end = dashboard_service.resolve_range("custom", from_date, to_date)

    def keep(r: dict) -> bool:
        if r["Employee ID"] not in emp_ids:
            return False
        if status and r["Status"] != status:
            return False
        if leave_type and r.get("Leave Type") != leave_type:
            return False
        if start and (timeutil.parse_date(r["To Date"]) < start or timeutil.parse_date(r["From Date"]) > end):
            return False
        return True

    items = rs.list_requests(kind, keep)
    for i in items:
        i["can_decide"] = rs.can_decide(user, store.get(rs.SHEET[kind], "Request ID", i["id"]))
    return items


@leave_router.post("", status_code=201)
def apply_leave(body: LeaveIn, user: CurrentUser = Depends(require_roles(EMPLOYEE, TEAM_LEAD))):
    return rs.create_request(rs.LEAVE, user, body.from_date, body.to_date, body.reason, body.leave_type)


@leave_router.get("/my")
def my_leave(user: CurrentUser = Depends(get_current_user)):
    return rs.list_requests(rs.LEAVE, lambda r: r["Employee ID"] == user["employee_id"])


@leave_router.get("")
def leave_overview(from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"), status: str = "",
                   employee_id: str = "", department: str = "", leave_type: str = "", team_lead_id: str = "",
                   user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    return _overview(rs.LEAVE, user, from_date, to_date, status, employee_id, department, leave_type, team_lead_id)


@leave_router.post("/{request_id}/approve")
def approve_leave(request_id: str, user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    return rs.decide(rs.LEAVE, request_id, user, True)


@leave_router.post("/{request_id}/reject")
def reject_leave(request_id: str, body: RejectIn, user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    return rs.decide(rs.LEAVE, request_id, user, False, body.reason)


@wfh_router.post("", status_code=201)
def apply_wfh(body: WfhIn, user: CurrentUser = Depends(require_roles(EMPLOYEE, TEAM_LEAD))):
    return rs.create_request(rs.WFH, user, body.from_date, body.to_date, body.reason)


@wfh_router.get("/my")
def my_wfh(user: CurrentUser = Depends(get_current_user)):
    return rs.list_requests(rs.WFH, lambda r: r["Employee ID"] == user["employee_id"])


@wfh_router.get("/requests")
def wfh_overview(from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"), status: str = "",
                 employee_id: str = "", department: str = "", team_lead_id: str = "",
                 user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    return _overview(rs.WFH, user, from_date, to_date, status, employee_id, department, "", team_lead_id)


@wfh_router.post("/{request_id}/approve")
def approve_wfh(request_id: str, user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    return rs.decide(rs.WFH, request_id, user, True)


@wfh_router.post("/{request_id}/reject")
def reject_wfh(request_id: str, body: RejectIn, user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    return rs.decide(rs.WFH, request_id, user, False, body.reason)


@requests_router.get("/my")
def my_requests(type: str = "all", user: CurrentUser = Depends(get_current_user)):
    if type not in ("all", "leave", "wfh"):
        raise HTTPException(422, "type must be all, leave or wfh")
    mine = lambda r: r["Employee ID"] == user["employee_id"]
    items = []
    if type in ("all", "leave"):
        items += rs.list_requests(rs.LEAVE, mine)
    if type in ("all", "wfh"):
        items += rs.list_requests(rs.WFH, mine)
    return sorted(items, key=lambda x: x["created"], reverse=True)


@requests_router.get("/pending")
def pending(type: str = "all", user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    kind = {"leave": rs.LEAVE, "wfh": rs.WFH}.get(type)
    return rs.pending_for(user, kind)


@requests_router.get("/history")
def decided_history(user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    """Requests this user has approved or rejected."""
    mine = lambda r: r["Approver ID"] == user["employee_id"]
    return sorted(rs.list_requests(rs.LEAVE, mine) + rs.list_requests(rs.WFH, mine),
                  key=lambda x: x["approval_date"], reverse=True)
