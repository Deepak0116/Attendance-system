"""Add one user. Usage: python scripts/add_user.py USERNAME "Full Name" ROLE "Department" ["Team Lead username"]"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from app import config, seed  # noqa: E402
from app.utils.excel_store import store  # noqa: E402


def main() -> None:
    username, name, role, dept = sys.argv[1:5]
    tl_user = sys.argv[5] if len(sys.argv) > 5 else ""
    seed.run()
    with store.transaction():
        if any(u["Username"].lower() == username.lower() for u in store.rows("Users")):
            sys.exit(f"'{username}' already exists")
        tl_emp = ""
        if tl_user:
            u = next(u for u in store.rows("Users") if u["Username"].lower() == tl_user.lower())
            tl_emp = store.find("Employees", **{"User ID": u["User ID"]})[0]["Employee ID"]
        password = seed.random_password()
        emp = seed.create_user(username, password, role, name, f"{username}@astenlabs.com", dept, role, tl_emp)
    line = f"{emp['Employee ID']}  {name:<18} {role:<10} {dept:<15} username: {username:<10} password: {password}"
    with open(config.DATA_FILE.parent / "initial_credentials.txt", "a", encoding="utf-8") as fh:
        fh.write(line + "\n")
    print(line)


if __name__ == "__main__":
    main()
