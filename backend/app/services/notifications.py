from app.services import directory
from app.utils import timeutil
from app.utils.excel_store import store


def notify_users(user_ids: list[str], title: str, message: str, ntype: str, dedupe_key: str = "", link: str = "") -> None:
    """Insert notifications (call inside a transaction). ``dedupe_key`` is embedded in Type to avoid repeats."""
    full_type = f"{ntype}|{dedupe_key}" if dedupe_key else ntype
    for uid in user_ids:
        if not uid:
            continue
        if dedupe_key and any(n["User ID"] == uid and n["Type"] == full_type for n in store.rows("Notifications")):
            continue
        store.insert("Notifications", {
            "Notification ID": store.next_id("Notifications", "Notification ID", "N", 6), "User ID": uid,
            "Employee ID": directory.employee_id_of_user(uid),
            "Title": title, "Message": message, "Type": full_type, "Read Status": "Unread",
            "Created Date": timeutil.now_str(), "Link": link,
        })


def notify_employee(employee_id: str, title: str, message: str, ntype: str, dedupe_key: str = "", link: str = "") -> None:
    notify_users([directory.user_id_of(employee_id)], title, message, ntype, dedupe_key, link)


def notify_hr(title: str, message: str, ntype: str, link: str = "") -> None:
    notify_users(directory.hr_user_ids(), title, message, ntype, link=link)


def notify_admins(title: str, message: str, ntype: str, dedupe_key: str = "", link: str = "") -> None:
    notify_users(directory.admin_user_ids(), title, message, ntype, dedupe_key, link)


def to_dto(n: dict) -> dict:
    return {"id": n["Notification ID"], "title": n["Title"], "message": n["Message"], "type": n["Type"].split("|")[0],
            "read": n["Read Status"] == "Read", "created": n["Created Date"], "link": n["Link"]}
