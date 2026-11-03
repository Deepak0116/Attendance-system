"""Loads the real Asten Labs staff into the workbook (safe to re-run: existing usernames are skipped).

    cd backend
    .venv\\Scripts\\python.exe scripts\\load_staff.py

Each new person gets a random initial password, written to data/initial_credentials.txt.
They should change it on the Profile page, and the file should then be deleted.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, seed  # noqa: E402
from app.utils.excel_store import store  # noqa: E402

# username, name, role, department, team lead username
STAFF = [
    ("shahid", "Shahid Afridi", "Team Lead", "Armada", ""),
    ("infant", "Infant Kebinraj", "Employee", "Armada", "shahid"),
    ("godwinson", "Godwinson", "Employee", "Armada", "shahid"),
    ("abdul", "Abdul Jabbar", "Employee", "Armada", "shahid"),
    ("deepak", "Deepak", "Employee", "Support Armada", "shahid"),
    ("salman", "Salman Faris", "Employee", "Support Armada", "shahid"),
    ("mani", "Mani Bharathi", "Employee", "Support Armada", "shahid"),
]


def main() -> None:
    seed.run()
    lines = []
    with store.transaction():
        existing = {u["Username"].lower(): u for u in store.rows("Users")}
        emp_ids = {u["Username"].lower(): (store.find("Employees", **{"User ID": u["User ID"]}) or [{}])[0].get("Employee ID", "")
                   for u in store.rows("Users")}
        for username, name, role, dept, tl in STAFF:
            if username in existing:
                print(f"skip  {username} (already exists)")
                continue
            password = seed.random_password()
            emp = seed.create_user(username, password, role, name, f"{username}@astenlabs.com", dept, role,
                                   emp_ids.get(tl, ""))
            emp_ids[username] = emp["Employee ID"]
            lines.append(f"{emp['Employee ID']}  {name:<18} {role:<10} {dept:<15} username: {username:<10} password: {password}")
            print(f"added {emp['Employee ID']} {name}")
    if lines:
        out = config.DATA_FILE.parent / "initial_credentials.txt"
        with open(out, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")
        print(f"\nInitial passwords saved to {out}")


if __name__ == "__main__":
    main()
