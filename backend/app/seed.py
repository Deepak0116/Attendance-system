"""Creates the workbook with the minimum a fresh install needs: departments, leave types and one Admin account.

No demo employees are created. Add real staff from Admin -> Employees, or with scripts/load_staff.py.
"""
import logging
import os
import secrets
import string

from app import config
from app.auth.security import hash_password
from app.services import settings_service
from app.utils import timeutil
from app.utils.excel_store import StoreError, store

ALL_WEEK = "Mon,Tue,Wed,Thu,Fri,Sat,Sun"
# name -> working days ("" = company default week). A 7-day team earns comp-off for off-day work.
DEPARTMENTS = {"Armada": "", "Support Armada": ALL_WEEK, "Human Resources": "", "Administration": ""}
LEAVE_TYPES = ["Casual Leave", "Sick Leave", "Personal Leave", "Comp Off", "Other"]


def random_password(length: int = 10) -> str:
    alphabet = string.ascii_letters + string.digits
    while True:
        pw = "".join(secrets.choice(alphabet) for _ in range(length))
        if any(c.islower() for c in pw) and any(c.isupper() for c in pw) and any(c.isdigit() for c in pw):
            return pw


def create_user(username: str, password: str, role: str, name: str, email: str, department: str, designation: str,
                team_lead_id: str = "", phone: str = "", joining_date: str = "") -> dict:
    """Must run inside a transaction."""
    user_id = store.next_id("Users", "User ID", "U", 4)
    emp_id = store.next_id("Employees", "Employee ID", "EMP", 3)
    store.insert("Users", {"User ID": user_id, "Employee ID": emp_id, "Username": username, "Password Hash": hash_password(password),
                           "Role": role, "Active Status": "Active", "Created Date": timeutil.now_str()})
    return store.insert("Employees", {
        "Employee ID": emp_id, "User ID": user_id, "Name": name, "Email": email, "Phone": phone, "Department": department,
        "Designation": designation, "Team Lead ID": team_lead_id, "Status": "Active",
        "Joining Date": joining_date or timeutil.today().isoformat()})


def backfill_employee_ids() -> None:
    """Older workbooks have no Employee ID on Users / Notifications / Approval History: fill them in."""
    with store.transaction():
        emp_by_user = {e["User ID"]: e["Employee ID"] for e in store.rows("Employees")}
        for u in store.rows("Users"):
            if not u["Employee ID"] and u["User ID"] in emp_by_user:
                store.update("Users", "User ID", u["User ID"], {"Employee ID": emp_by_user[u["User ID"]]})
        for n in store.rows("Notifications"):
            if not n["Employee ID"] and n["User ID"] in emp_by_user:
                store.update("Notifications", "Notification ID", n["Notification ID"], {"Employee ID": emp_by_user[n["User ID"]]})
        for a in store.rows("Approval History"):
            if not a["Employee ID"] and a["Requester ID"]:
                store.update("Approval History", "Approval ID", a["Approval ID"], {"Employee ID": a["Requester ID"]})


def run() -> None:
    created = store.initialise()
    settings_service.ensure_defaults()
    try:
        backfill_employee_ids()
    except StoreError as exc:  # e.g. the workbook is open in Excel: not fatal, it is retried on the next start
        logging.getLogger('attendance').warning('Employee ID backfill skipped: %s', exc)
    with store.transaction():
        if not store.rows("Departments"):
            for d, days in DEPARTMENTS.items():
                store.insert("Departments", {"Department ID": store.next_id("Departments", "Department ID", "D", 3),
                                             "Department Name": d, "Working Days": days})
        if not store.rows("Leave Types"):
            for lt in LEAVE_TYPES:
                store.insert("Leave Types", {"Leave Type ID": store.next_id("Leave Types", "Leave Type ID", "LT", 3),
                                             "Leave Type Name": lt, "Active": "Yes"})
        if created and not store.rows("Users"):
            password = os.getenv("ADMIN_PASSWORD") or random_password()
            create_user("admin", password, "Admin", "System Admin", "admin@astenlabs.com", "Administration", "Administrator")
            if not os.getenv("ADMIN_PASSWORD"):
                note = config.DATA_FILE.parent / "initial_admin_password.txt"
                note.write_text(f"username: admin\npassword: {password}\n(change it on the Profile page, then delete this file)\n",
                                encoding="utf-8")
