"""Leave and WFH requests: routing, overlap validation and approval workflow."""
from datetime import date, timedelta

from fastapi import HTTPException

from app.auth.deps import ADMIN, EMPLOYEE, HR, TEAM_LEAD, CurrentUser
from app.services import comp_off_service, directory, notifications, settings_service
from app.utils import timeutil
from app.utils.excel_store import store

PENDING_TL, PENDING_HR, APPROVED, REJECTED = "Pending TL Approval", "Pending HR Approval", "Approved", "Rejected"
LEAVE, WFH = "Leave", "WFH"
SHEET = {LEAVE: "Leave Requests", WFH: "WFH Requests"}
ID_PREFIX = {LEAVE: "LR", WFH: "WR"}


def _parse_range(from_date: str, to_date: str) -> tuple[date, date]:
    try:
        a, b = timeutil.parse_date(from_date), timeutil.parse_date(to_date)
    except ValueError:
        raise HTTPException(422, "Invalid date format. Use YYYY-MM-DD.")
    if a > b:
        raise HTTPException(422, "From Date cannot be after To Date.")
    if a < timeutil.today():
        raise HTTPException(422, "Requests cannot start in the past.")
    return a, b


def _check_overlap(sheet: str, employee_id: str, a: date, b: date) -> None:
    for r in store.rows(sheet):
        if r["Employee ID"] == employee_id and r["Status"] in (PENDING_TL, PENDING_HR, APPROVED):
            ra, rb = timeutil.parse_date(r["From Date"]), timeutil.parse_date(r["To Date"])
            if a <= rb and ra <= b:
                raise HTTPException(409, f"This overlaps an existing {r['Status'].lower()} request "
                                         f"({r['From Date']} to {r['To Date']}).")


def _route(user: CurrentUser) -> tuple[str, str]:
    """Returns (initial status, assigned approver)."""
    if user["role"] == EMPLOYEE:
        tl = store.get("Employees", "Employee ID", user["team_lead_id"]) if user["team_lead_id"] else None
        if not tl or tl["Status"] != "Active":
            raise HTTPException(400, "You are not mapped to an active Team Lead. Please contact HR/Admin.")
        return PENDING_TL, tl["Employee ID"]
    if user["role"] == TEAM_LEAD:
        return PENDING_HR, "HR"
    raise HTTPException(403, "Only Employees and Team Leads can submit leave/WFH requests.")


def create_request(kind: str, user: CurrentUser, from_date: str, to_date: str, reason: str, leave_type: str = "") -> dict:
    reason = (reason or "").strip()
    if len(reason) < 3:
        raise HTTPException(422, "Please provide a reason.")
    a, b = _parse_range(from_date, to_date)
    sheet = SHEET[kind]
    with store.transaction():
        if kind == LEAVE:
            lt = [t for t in store.rows("Leave Types") if t["Leave Type Name"] == leave_type and t["Active"] == "Yes"]
            if not lt:
                raise HTTPException(422, "Invalid leave type.")
            if leave_type == comp_off_service.COMP_OFF_TYPE:
                comp_off_service.validate_request(user["employee_id"], a, b)
        status, assigned = _route(user)
        _check_overlap(sheet, user["employee_id"], a, b)
        row = {"Request ID": store.next_id(sheet, "Request ID", ID_PREFIX[kind], 5), "Employee ID": user["employee_id"],
               "From Date": a.isoformat(), "To Date": b.isoformat(), "Reason": reason, "Status": status,
               "Approver ID": "", "Approval Date": "", "Rejection Reason": "", "Created Date": timeutil.now_str(),
               "Assigned To": assigned}
        if kind == LEAVE:
            row["Leave Type"] = leave_type
        saved = store.insert(sheet, row)
        label = "leave" if kind == LEAVE else "WFH"
        title = f"New {'Team Lead' if user['role'] == TEAM_LEAD else 'Employee'} {label} request"
        msg = f"{user['name']} requested {label} from {a.isoformat()} to {b.isoformat()}."
        link = f"/pending?request={row['Request ID']}&type={kind.lower()}"
        if user["role"] == EMPLOYEE:
            notifications.notify_employee(assigned, title, msg, f"{kind}_request", link=link)
        else:
            notifications.notify_hr(title, msg, f"{kind}_request", link=link)
    return to_dto(kind, saved)


def to_dto(kind: str, r: dict, names: dict | None = None) -> dict:
    names = names if names is not None else {e["employee_id"]: e for e in directory.enrich_all()}
    emp = names.get(r["Employee ID"], {})
    approver = names.get(r["Approver ID"], {})
    return {
        "id": r["Request ID"], "type": kind, "employee_id": r["Employee ID"], "employee_name": emp.get("name", ""),
        "department": emp.get("department", ""), "role": emp.get("role", ""), "team_lead_id": emp.get("team_lead_id", ""),
        "leave_type": r.get("Leave Type", ""), "from_date": r["From Date"], "to_date": r["To Date"],
        "reason": r["Reason"], "status": r["Status"], "approver_id": r["Approver ID"],
        "approver_name": approver.get("name", ""), "approval_date": r["Approval Date"],
        "rejection_reason": r["Rejection Reason"], "created": r["Created Date"], "assigned_to": r["Assigned To"],
    }


def list_requests(kind: str, rows_filter=None) -> list[dict]:
    names = {e["employee_id"]: e for e in directory.enrich_all()}
    rows = store.rows(SHEET[kind])
    if rows_filter:
        rows = [r for r in rows if rows_filter(r)]
    return sorted((to_dto(kind, r, names) for r in rows), key=lambda x: x["created"], reverse=True)


def can_decide(user: CurrentUser, req: dict) -> bool:
    """Approval routing rules. Nobody may decide their own request."""
    if req["Employee ID"] == user["employee_id"] or req["Status"] not in (PENDING_TL, PENDING_HR):
        return False
    role = user["role"]
    if req["Status"] == PENDING_TL:
        if role == TEAM_LEAD:
            return req["Assigned To"] == user["employee_id"]
        if role == HR:
            return settings_service.get_bool("hr_override_enabled")
        if role == ADMIN:
            return settings_service.get_bool("admin_override_enabled")
    if req["Status"] == PENDING_HR:
        if role == HR:
            return True
        if role == ADMIN:
            return settings_service.get_bool("admin_override_enabled")
    return False


CANCELLED = "Cancelled"


def _cancel_wfh_for_leave(leave: dict, approver: CurrentUser, now: str) -> None:
    """Leave wins over WFH. WFH requests lying fully inside the leave are cancelled; a WFH that only partly overlaps
    stays, but its overlapping days stop counting as WFH (see wfh_service.approved_request_for)."""
    la, lb = timeutil.parse_date(leave["From Date"]), timeutil.parse_date(leave["To Date"])
    emp = leave["Employee ID"]
    for w in store.rows("WFH Requests"):
        if w["Employee ID"] != emp or w["Status"] not in (PENDING_TL, PENDING_HR, APPROVED):
            continue
        wa, wb = timeutil.parse_date(w["From Date"]), timeutil.parse_date(w["To Date"])
        if wb < la or wa > lb:
            continue
        span = f"{w['From Date']} to {w['To Date']}"
        if la <= wa and wb <= lb:
            store.update("WFH Requests", "Request ID", w["Request ID"], {
                "Status": CANCELLED, "Rejection Reason": f"Cancelled because leave was approved ({leave['From Date']} to {leave['To Date']})"})
            store.insert("Approval History", {
                "Approval ID": store.next_id("Approval History", "Approval ID", "AP", 6), "Request ID": w["Request ID"],
                "Request Type": WFH, "Employee ID": emp, "Requester ID": emp, "Approver ID": approver["employee_id"],
                "Action": "Cancelled", "Reason": "Approved leave covers these dates", "Action Date": now})
            title, text = "WFH Cancelled", f"Your WFH ({span}) was cancelled because your leave ({leave['From Date']} to {leave['To Date']}) was approved."
        else:
            # partial overlap: shorten the WFH so it no longer includes the leave days (a middle overlap is split in two)
            iso = lambda d: d.isoformat()
            if wa < la:
                store.update("WFH Requests", "Request ID", w["Request ID"], {"To Date": iso(la - timedelta(days=1))})
                if wb > lb:
                    store.insert("WFH Requests", {**w, "Request ID": store.next_id("WFH Requests", "Request ID", ID_PREFIX[WFH], 5),
                                                  "From Date": iso(lb + timedelta(days=1)), "To Date": iso(wb)})
            else:
                store.update("WFH Requests", "Request ID", w["Request ID"], {"From Date": iso(lb + timedelta(days=1))})
            title, text = "WFH Updated", f"Your WFH ({span}) was shortened because your leave ({leave['From Date']} to {leave['To Date']}) was approved."
        link = f"/my-requests?request={w['Request ID']}&type=wfh"
        notifications.notify_employee(emp, title, text, "wfh_cancelled", link=link)
        if w["Assigned To"] and w["Assigned To"] != "HR":
            name = (store.get("Employees", "Employee ID", emp) or {}).get("Name", emp)
            notifications.notify_employee(w["Assigned To"], title, f"{name}: {text}", "wfh_cancelled")


def pending_for(user: CurrentUser, kind: str | None = None) -> list[dict]:
    out = []
    for k in ([kind] if kind else [LEAVE, WFH]):
        out += list_requests(k, lambda r, k=k: can_decide(user, r))
    return sorted(out, key=lambda x: x["created"])


def decide(kind: str, request_id: str, user: CurrentUser, approve: bool, reason: str = "") -> dict:
    reason = (reason or "").strip()
    if not approve and not reason:
        raise HTTPException(422, "A rejection reason is required.")
    sheet = SHEET[kind]
    with store.transaction():
        req = store.get(sheet, "Request ID", request_id)
        if not req:
            raise HTTPException(404, "Request not found")
        if req["Employee ID"] == user["employee_id"]:
            raise HTTPException(403, "You cannot approve or reject your own request.")
        if req["Status"] not in (PENDING_TL, PENDING_HR):
            raise HTTPException(409, f"This request has already been {req['Status'].lower()}.")
        if not can_decide(user, req):
            raise HTTPException(403, "You are not the designated approver for this request.")
        if approve and kind == LEAVE and req["Leave Type"] == comp_off_service.COMP_OFF_TYPE:
            comp_off_service.consume_on_approval(req["Employee ID"], req)
        now = timeutil.now_str()
        if approve and kind == LEAVE:
            _cancel_wfh_for_leave(req, user, now)
        saved = store.update(sheet, "Request ID", request_id, {
            "Status": APPROVED if approve else REJECTED, "Approver ID": user["employee_id"], "Approval Date": now,
            "Rejection Reason": "" if approve else reason})
        store.insert("Approval History", {
            "Approval ID": store.next_id("Approval History", "Approval ID", "AP", 6), "Request ID": request_id,
            "Request Type": kind, "Employee ID": req["Employee ID"], "Requester ID": req["Employee ID"], "Approver ID": user["employee_id"],
            "Action": "Approved" if approve else "Rejected", "Reason": reason, "Action Date": now})
        label = "Leave" if kind == LEAVE else "WFH"
        verdict = "approved" if approve else "rejected"
        extra = "" if approve else f" Reason: {reason}"
        notifications.notify_employee(
            req["Employee ID"], f"{label} {verdict.title()}",
            f"Your {label} request ({req['From Date']} to {req['To Date']}) was {verdict} by {user['name']}.{extra}",
            f"{kind}_{verdict}", link=f"/my-requests?request={request_id}&type={kind.lower()}")
    return to_dto(kind, saved)
