"""Test-only fixtures: a fake company the workflow tests run against. Never loaded in the real app."""
from app import seed
from app.utils.excel_store import store

DEPARTMENTS = {"Development": "", "Design": "", "QA": "", "Support": seed.ALL_WEEK}

# username, password, role, name, email, department, designation, team lead username
USERS = [
    ("hr", "Hr@12345", "HR", "Hannah Roy", "hr@test.local", "Human Resources", "HR Manager", ""),
    ("tl1", "Tl@12345", "Team Lead", "Karthik Raja", "karthik@test.local", "Development", "Team Lead", ""),
    ("tl2", "Tl@12345", "Team Lead", "Meena Iyer", "meena@test.local", "Design", "Design Lead", ""),
    ("deepak", "Emp@12345", "Employee", "Deepak", "deepak@test.local", "Development", "Engineer", "tl1"),
    ("arun", "Emp@12345", "Employee", "Arun", "arun@test.local", "Development", "Engineer", "tl1"),
    ("priya", "Emp@12345", "Employee", "Priya", "priya@test.local", "Development", "QA Engineer", "tl1"),
    ("sana", "Emp@12345", "Employee", "Sana Khan", "sana@test.local", "Design", "Designer", "tl2"),
    ("tl3", "Tl@12345", "Team Lead", "Suresh Kumar", "suresh@test.local", "Support", "Support Lead", ""),
    ("ravi", "Emp@12345", "Employee", "Ravi Shankar", "ravi@test.local", "Support", "Support Engineer", "tl3"),
    ("anita", "Emp@12345", "Employee", "Anita Das", "anita@test.local", "Support", "Support Engineer", "tl3"),
]


def load() -> None:
    with store.transaction():
        have = {d["Department Name"] for d in store.rows("Departments")}
        for name, days in DEPARTMENTS.items():
            if name not in have:
                store.insert("Departments", {"Department ID": store.next_id("Departments", "Department ID", "D", 3),
                                             "Department Name": name, "Working Days": days})
        ids: dict[str, str] = {}
        for username, pw, role, name, email, dept, desig, tl in USERS:
            emp = seed.create_user(username, pw, role, name, email, dept, desig, ids.get(tl, ""), joining_date="2024-01-15")
            ids[username] = emp["Employee ID"]
