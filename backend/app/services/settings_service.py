from app.utils.excel_store import store

DEFAULT_SETTINGS = {
    "company_name": ("Asten Labs", "Company name shown in the application"),
    "working_days": ("Mon,Tue,Wed,Thu,Fri,Sat", "Comma separated working days of the standard week"),
    "holiday_saturdays": ("2,4", "Saturdays of the month that are holidays, e.g. 2,4 = second and fourth Saturday (blank = none)"),
    "office_start_time": ("09:30", "Office start time (HH:MM, 24-hour) used for the early / late check-in message"),
    "late_grace_minutes": ("15", "Minutes after the start time that still count as on time"),
    "early_checkin_minutes": ("30", "Check-in at least this many minutes before the start time is treated as early"),
    "leave_allowance_per_month": ("1", "Leave days per month that are not counted as extra leave (Comp Off leave is never counted)"),
    "wfh_verification_interval_hours": ("4", "Hours between WFH location verifications"),
    "wfh_missed_grace_minutes": ("60", "Minutes after the due time before a verification is marked Missed"),
    "location_retention_days": ("90", "Days to keep precise WFH coordinates before they are erased"),
    "comp_off_expiry_days": ("90", "Days a comp-off credit stays usable (0 = never expires)"),
    "hr_override_enabled": ("false", "Allow HR to approve normal employee requests"),
    "admin_override_enabled": ("true", "Allow Admin to approve any request (except their own)"),
}

DAY_INDEX = {"Mon": 0, "Tue": 1, "Wed": 2, "Thu": 3, "Fri": 4, "Sat": 5, "Sun": 6}


def ensure_defaults() -> None:
    with store.transaction():
        existing = {r["Key"] for r in store.rows("Settings")}
        for key, (value, desc) in DEFAULT_SETTINGS.items():
            if key not in existing:
                store.insert("Settings", {"Key": key, "Value": value, "Description": desc})


def get_setting(key: str) -> str:
    row = store.get("Settings", "Key", key)
    if row and row["Value"] != "":
        return row["Value"]
    return DEFAULT_SETTINGS[key][0]


def get_int(key: str) -> int:
    try:
        return int(float(get_setting(key)))
    except ValueError:
        return int(DEFAULT_SETTINGS[key][0])


def office_start_minutes() -> int:
    """Office start as minutes after midnight (falls back to 09:30 if the setting is malformed)."""
    try:
        h, m = (int(x) for x in get_setting("office_start_time").split(":")[:2])
        if 0 <= h < 24 and 0 <= m < 60:
            return h * 60 + m
    except ValueError:
        pass
    return 9 * 60 + 30


def get_bool(key: str) -> bool:
    return get_setting(key).strip().lower() in ("true", "1", "yes")


def parse_days(text: str) -> set[int]:
    return {DAY_INDEX[d.strip()[:3].title()] for d in text.split(",") if d.strip()[:3].title() in DAY_INDEX}


def working_weekdays() -> set[int]:
    """Company default working days (the standard week)."""
    return parse_days(get_setting("working_days")) or {0, 1, 2, 3, 4}


def holiday_saturdays() -> set[int]:
    return {int(x) for x in get_setting("holiday_saturdays").replace(";", ",").split(",") if x.strip().isdigit() and 1 <= int(x) <= 5}


def nth_weekday_of_month(d) -> int:
    """1 for the first such weekday of the month, 2 for the second, ..."""
    return (d.day - 1) // 7 + 1


def is_company_working_day(d) -> bool:
    """Standard company week minus holiday Saturdays (e.g. every 2nd and 4th Saturday)."""
    if d.weekday() not in working_weekdays():
        return False
    return not (d.weekday() == 5 and nth_weekday_of_month(d) in holiday_saturdays())


def department_weekdays() -> dict[str, set[int]]:
    """Department name -> working weekdays, only for departments with their own schedule (e.g. Support = 7 days)."""
    return {d["Department Name"]: parse_days(d["Working Days"]) for d in store.rows("Departments") if parse_days(d["Working Days"])}


def all_settings() -> list[dict]:
    return [{"key": r["Key"], "value": r["Value"], "description": r["Description"]} for r in store.rows("Settings")]
