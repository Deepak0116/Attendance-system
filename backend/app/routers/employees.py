from fastapi import APIRouter, Depends, HTTPException, Query

from app.auth.deps import ADMIN, EMPLOYEE, HR, TEAM_LEAD, CurrentUser, get_current_user, require_roles
from app.schemas.models import EmployeeIn, NameIn, StatusIn
from app.seed import create_user
from app.services import directory, settings_service
from app.utils import timeutil
from app.utils.excel_store import store

router = APIRouter(tags=["Employees & Master Data"])


# ------------------------------------------------------------------ employees
@router.get("/employees")
def list_employees(department: str = "", status: str = "active", search: str = "", team_lead_id: str = "",
                   user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    emps = directory.visible_employees(user, department=department, team_lead_id=team_lead_id,
                                       include_inactive=status != "active")
    if status == "inactive":
        emps = [e for e in emps if e["status"] != "Active"]
    if search:
        s = search.lower()
        emps = [e for e in emps if s in e["name"].lower() or s in e["employee_id"].lower() or s in e["email"].lower()]
    return sorted(emps, key=lambda e: e["employee_id"])


@router.get("/employees/team-leads")
def team_leads(user: CurrentUser = Depends(require_roles(HR, ADMIN))):
    return [e for e in directory.enrich_all() if e["role"] == TEAM_LEAD and e["status"] == "Active"]


@router.get("/employees/{employee_id}")
def get_employee(employee_id: str, user: CurrentUser = Depends(get_current_user)):
    return directory.assert_can_view_employee(user, employee_id)


def _validate(body: EmployeeIn, existing_emp_id: str = "", existing_user_id: str = "") -> str:
    if not store.find("Departments", **{"Department Name": body.department}):
        raise HTTPException(422, "Unknown department")
    if any(e["Email"].lower() == body.email.lower() and e["Employee ID"] != existing_emp_id for e in store.rows("Employees")):
        raise HTTPException(409, "An employee with this email already exists")
    team_lead_id = body.team_lead_id
    if body.role == EMPLOYEE:
        tl = store.get("Employees", "Employee ID", team_lead_id) if team_lead_id else None
        tl_user = store.get("Users", "User ID", tl["User ID"]) if tl else None
        if not tl_user or tl_user["Role"] != TEAM_LEAD or tl["Status"] != "Active":
            raise HTTPException(422, "Every employee must be mapped to an active Team Lead")
    else:
        team_lead_id = ""
    if body.joining_date:
        try:
            timeutil.parse_date(body.joining_date)
        except ValueError:
            raise HTTPException(422, "Invalid joining date")
    return team_lead_id


@router.post("/employees", status_code=201)
def create_employee(body: EmployeeIn, user: CurrentUser = Depends(require_roles(ADMIN))):
    username = (body.username or body.email.split("@")[0]).strip().lower()
    if len(body.password) < 8:
        raise HTTPException(422, "Initial password must be at least 8 characters")
    with store.transaction():
        if any(u["Username"].lower() == username for u in store.rows("Users")):
            raise HTTPException(409, "Username already exists")
        tl = _validate(body)
        emp = create_user(username, body.password, body.role, body.name.strip(), body.email.strip(), body.department,
                          body.designation, tl, body.phone, body.joining_date)
    return directory.get_employee(emp["Employee ID"])


@router.put("/employees/{employee_id}")
def update_employee(employee_id: str, body: EmployeeIn, user: CurrentUser = Depends(require_roles(ADMIN))):
    with store.transaction():
        emp = store.get("Employees", "Employee ID", employee_id)
        if not emp:
            raise HTTPException(404, "Employee not found")
        u = store.get("Users", "User ID", emp["User ID"])
        tl = _validate(body, employee_id, emp["User ID"])
        if employee_id == user["employee_id"] and body.role != u["Role"]:
            raise HTTPException(400, "You cannot change your own role")
        if u["Role"] == TEAM_LEAD and body.role != TEAM_LEAD and directory.team_member_ids(employee_id):
            raise HTTPException(409, "Reassign this Team Lead's team members before changing the role")
        store.update("Employees", "Employee ID", employee_id, {
            "Name": body.name.strip(), "Email": body.email.strip(), "Phone": body.phone, "Department": body.department,
            "Designation": body.designation, "Team Lead ID": tl,
            "Joining Date": body.joining_date or emp["Joining Date"]})
        store.update("Users", "User ID", emp["User ID"], {"Role": body.role})
        if body.password:
            if len(body.password) < 8:
                raise HTTPException(422, "Password must be at least 8 characters")
            from app.auth.security import hash_password
            store.update("Users", "User ID", emp["User ID"], {"Password Hash": hash_password(body.password)})
    return directory.get_employee(employee_id)


@router.post("/employees/{employee_id}/status")
def set_status(employee_id: str, body: StatusIn, user: CurrentUser = Depends(require_roles(ADMIN))):
    with store.transaction():
        emp = store.get("Employees", "Employee ID", employee_id)
        if not emp:
            raise HTTPException(404, "Employee not found")
        if employee_id == user["employee_id"] and not body.active:
            raise HTTPException(400, "You cannot deactivate your own account")
        if not body.active:
            team = [e for e in store.rows("Employees") if e["Team Lead ID"] == employee_id and e["Status"] == "Active"]
            if team:
                raise HTTPException(409, "This Team Lead still has active team members. Reassign them first.")
        value = "Active" if body.active else "Inactive"
        store.update("Employees", "Employee ID", employee_id, {"Status": value})
        store.update("Users", "User ID", emp["User ID"], {"Active Status": value})
    return directory.get_employee(employee_id)


# ---------------------------------------------------------------- departments
def _dept_dto(d: dict) -> dict:
    return {"id": d["Department ID"], "name": d["Department Name"], "working_days": d["Working Days"]}


def _clean_days(value: str | None) -> str:
    """Validate a comma separated weekday list; empty means 'use the company default week'."""
    if not value or not value.strip():
        return ""
    days = [x.strip()[:3].title() for x in value.split(",") if x.strip()]
    if any(x not in settings_service.DAY_INDEX for x in days):
        raise HTTPException(422, "Working days must look like Mon,Tue,Wed,Thu,Fri,Sat,Sun")
    return ",".join(sorted(set(days), key=lambda x: settings_service.DAY_INDEX[x]))


@router.get("/departments")
def departments(user: CurrentUser = Depends(get_current_user)):
    return [_dept_dto(d) for d in store.rows("Departments")]


@router.post("/departments", status_code=201)
def add_department(body: NameIn, user: CurrentUser = Depends(require_roles(ADMIN, HR))):
    with store.transaction():
        if any(d["Department Name"].lower() == body.name.strip().lower() for d in store.rows("Departments")):
            raise HTTPException(409, "Department already exists")
        d = store.insert("Departments", {"Department ID": store.next_id("Departments", "Department ID", "D", 3),
                                         "Department Name": body.name.strip(), "Working Days": _clean_days(body.working_days)})
    return _dept_dto(d)


@router.put("/departments/{dept_id}")
def rename_department(dept_id: str, body: NameIn, user: CurrentUser = Depends(require_roles(ADMIN, HR))):
    with store.transaction():
        d = store.get("Departments", "Department ID", dept_id)
        if not d:
            raise HTTPException(404, "Department not found")
        new = body.name.strip()
        if any(x["Department Name"].lower() == new.lower() and x["Department ID"] != dept_id for x in store.rows("Departments")):
            raise HTTPException(409, "Department already exists")
        for e in store.rows("Employees"):
            if e["Department"] == d["Department Name"]:
                store.update("Employees", "Employee ID", e["Employee ID"], {"Department": new})
        changes = {"Department Name": new}
        if body.working_days is not None:
            changes["Working Days"] = _clean_days(body.working_days)
        d = store.update("Departments", "Department ID", dept_id, changes)
    return _dept_dto(d)


# ---------------------------------------------------------------- leave types
@router.get("/leave-types")
def leave_types(all: bool = Query(False), user: CurrentUser = Depends(get_current_user)):
    include_all = all and user["role"] in (ADMIN, HR)
    return [{"id": t["Leave Type ID"], "name": t["Leave Type Name"], "active": t["Active"] == "Yes"}
            for t in store.rows("Leave Types") if include_all or t["Active"] == "Yes"]


@router.post("/leave-types", status_code=201)
def add_leave_type(body: NameIn, user: CurrentUser = Depends(require_roles(ADMIN, HR))):
    with store.transaction():
        if any(t["Leave Type Name"].lower() == body.name.strip().lower() for t in store.rows("Leave Types")):
            raise HTTPException(409, "Leave type already exists")
        t = store.insert("Leave Types", {"Leave Type ID": store.next_id("Leave Types", "Leave Type ID", "LT", 3),
                                         "Leave Type Name": body.name.strip(), "Active": "Yes" if body.active else "No"})
    return {"id": t["Leave Type ID"], "name": t["Leave Type Name"], "active": t["Active"] == "Yes"}


@router.put("/leave-types/{type_id}")
def update_leave_type(type_id: str, body: NameIn, user: CurrentUser = Depends(require_roles(ADMIN, HR))):
    with store.transaction():
        if not store.get("Leave Types", "Leave Type ID", type_id):
            raise HTTPException(404, "Leave type not found")
        if any(t["Leave Type Name"].lower() == body.name.strip().lower() and t["Leave Type ID"] != type_id
               for t in store.rows("Leave Types")):
            raise HTTPException(409, "Leave type already exists")
        t = store.update("Leave Types", "Leave Type ID", type_id,
                         {"Leave Type Name": body.name.strip(), "Active": "Yes" if body.active else "No"})
    return {"id": t["Leave Type ID"], "name": t["Leave Type Name"], "active": t["Active"] == "Yes"}
