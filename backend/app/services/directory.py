"""Employee / team lookups and role-based visibility."""
from fastapi import HTTPException

from app.auth.deps import ADMIN, EMPLOYEE, HR, TEAM_LEAD, CurrentUser
from app.utils.excel_store import store


def _users_by_id() -> dict[str, dict]:
    return {u["User ID"]: u for u in store.rows("Users")}


def enrich_all() -> list[dict]:
    users = _users_by_id()
    emps = store.rows("Employees")
    names = {e["Employee ID"]: e["Name"] for e in emps}
    out = []
    for e in emps:
        u = users.get(e["User ID"], {})
        out.append({
            "employee_id": e["Employee ID"], "user_id": e["User ID"], "name": e["Name"], "email": e["Email"],
            "phone": e["Phone"], "department": e["Department"], "designation": e["Designation"],
            "team_lead_id": e["Team Lead ID"], "team_lead_name": names.get(e["Team Lead ID"], ""),
            "status": e["Status"], "joining_date": e["Joining Date"],
            "role": u.get("Role", ""), "username": u.get("Username", ""),
        })
    return out


def get_employee(employee_id: str) -> dict | None:
    for e in enrich_all():
        if e["employee_id"] == employee_id:
            return e
    return None


def team_member_ids(tl_employee_id: str) -> set[str]:
    return {e["Employee ID"] for e in store.rows("Employees") if e["Team Lead ID"] == tl_employee_id}


def hr_user_ids() -> list[str]:
    return [u["User ID"] for u in store.rows("Users") if u["Role"] == HR and u["Active Status"] == "Active"]


def admin_user_ids() -> list[str]:
    return [u["User ID"] for u in store.rows("Users") if u["Role"] == ADMIN and u["Active Status"] == "Active"]


def employee_id_of_user(user_id: str) -> str:
    e = store.find("Employees", **{"User ID": user_id})
    return e[0]["Employee ID"] if e else ""


def user_id_of(employee_id: str) -> str:
    e = store.get("Employees", "Employee ID", employee_id)
    return e["User ID"] if e else ""


def visible_employees(user: CurrentUser, *, employee_id: str = "", department: str = "", team_lead_id: str = "",
                      include_inactive: bool = False, exclude_admin: bool = False) -> list[dict]:
    """Employees the user may see, with optional filters. TLs only ever see their own team."""
    emps = enrich_all()
    role = user["role"]
    if role == EMPLOYEE:
        emps = [e for e in emps if e["employee_id"] == user["employee_id"]]
    elif role == TEAM_LEAD:
        emps = [e for e in emps if e["team_lead_id"] == user["employee_id"]]
    if not include_inactive:
        emps = [e for e in emps if e["status"] == "Active"]
    if exclude_admin:
        emps = [e for e in emps if e["role"] != ADMIN]
    if employee_id:
        emps = [e for e in emps if e["employee_id"] == employee_id]
    if department:
        emps = [e for e in emps if e["department"] == department]
    if team_lead_id:
        emps = [e for e in emps if e["team_lead_id"] == team_lead_id]
    return emps


def assert_can_view_employee(user: CurrentUser, employee_id: str) -> dict:
    emp = get_employee(employee_id)
    if not emp:
        raise HTTPException(404, "Employee not found")
    if user["role"] in (HR, ADMIN):
        return emp
    if user["role"] == TEAM_LEAD and (emp["team_lead_id"] == user["employee_id"] or emp["employee_id"] == user["employee_id"]):
        return emp
    if user["role"] == EMPLOYEE and emp["employee_id"] == user["employee_id"]:
        return emp
    raise HTTPException(403, "You can only access employees in your own team")
