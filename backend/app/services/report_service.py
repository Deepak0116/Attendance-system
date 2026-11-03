import csv
import io

import pandas as pd

from app.auth.deps import CurrentUser
from app.services import attendance_service as att
from app.services import dashboard_service, directory, request_service, wfh_service
from app.utils.excel_store import store
from app.utils import timeutil


def _t(ts: str) -> str:
    return timeutil.parse_dt(ts).strftime("%I:%M %p") if ts else ""


def _d(ts: str) -> str:
    return ts[:10] if ts else ""


def attendance_report(user: CurrentUser, start, end, employee_id="", department="", status="", team_lead_id=""):
    emps = directory.visible_employees(user, employee_id=employee_id, department=department, team_lead_id=team_lead_id,
                                       exclude_admin=True)
    res = att.DayResolver()
    rows = []
    for e, d, s in dashboard_service.status_matrix(emps, start, end):
        if status and s != status:
            continue
        rows.append({"Employee ID": e["employee_id"], "Employee": e["name"], "Department": e["department"],
                     "Date": d.isoformat(), "Check-in Time": _t(res.check_in(e["employee_id"], d)), "Status": s})
    rows.sort(key=lambda r: (r["Date"], r["Employee"]), reverse=True)
    return list(rows[0].keys()) if rows else ATT_COLS, rows


def leave_report(user: CurrentUser, start, end, employee_id="", department="", status="", leave_type=""):
    emps = {e["employee_id"] for e in directory.visible_employees(user, employee_id=employee_id, department=department,
                                                                   include_inactive=True)}
    items = request_service.list_requests(request_service.LEAVE, lambda r: r["Employee ID"] in emps)
    rows = []
    for r in items:
        if timeutil.parse_date(r["to_date"]) < start or timeutil.parse_date(r["from_date"]) > end:
            continue
        if status and r["status"] != status or leave_type and r["leave_type"] != leave_type:
            continue
        rows.append({"Employee ID": r["employee_id"], "Employee": r["employee_name"], "Department": r["department"],
                     "Leave Type": r["leave_type"], "From Date": r["from_date"], "To Date": r["to_date"],
                     "Reason": r["reason"], "Status": r["status"], "Decided By": r["approver_name"],
                     "Decision Date": _d(r["approval_date"]), "Rejection Reason": r["rejection_reason"]})
    return LEAVE_COLS, rows


def wfh_report(user: CurrentUser, start, end, employee_id="", department="", status="", team_lead_id=""):
    items = wfh_service.sessions(user, start, end, employee_id=employee_id, department=department,
                                 team_lead_id=team_lead_id, status=status)
    rows = []
    for s in items:
        rows.append({"Employee ID": s["employee_id"], "Employee": s["employee_name"], "Department": s["department"],
                     "Date": s["date"], "Start Time": _t(s["start_time"]), "Last Verification": _t(s["last_verification"]),
                     "Next Verification": _t(s["next_verification"]), "Verification Status": s["status"],
                     "Latitude": s.get("latitude", ""), "Longitude": s.get("longitude", "")})
    return WFH_COLS, rows


SUMMARY_COLS = ["Employee ID", "Employee", "Department", "Team Lead", "Working Days (Period)", "Working Days (Till Today)",
                "Present", "WFH", "Leave", "Comp Off", "Extra Leave", "Not Checked In", "Attendance %"]
SUMMARY_SUM_COLS = SUMMARY_COLS[4:12]


def summary_report(user: CurrentUser, start, end, employee_id="", department="", team_lead_id=""):
    """One row per employee for the period: working days, present, WFH, leave, comp off, extra leave.

    Extra leave = leave days beyond ``leave_allowance_per_month`` within a calendar month. Comp Off leave is
    shown separately and never counts towards it. Days are counted chronologically from the 1st of the month so a
    weekly report still knows how much of the month's allowance was already used.
    """
    from app.services import comp_off_service, settings_service

    emps = directory.visible_employees(user, employee_id=employee_id, department=department,
                                       team_lead_id=team_lead_id, exclude_admin=True)
    res = att.DayResolver()
    today = timeutil.today()
    allowance = settings_service.get_int("leave_allowance_per_month")
    first = start.replace(day=1)
    types: dict[tuple[str, object], str] = {}
    for r in store.rows("Leave Requests"):
        if r["Status"] != "Approved":
            continue
        a, b = timeutil.parse_date(r["From Date"]), timeutil.parse_date(r["To Date"])
        for d in timeutil.daterange(max(a, first), min(b, end)):
            types[(r["Employee ID"], d)] = r["Leave Type"]
    rows = []
    for e in emps:
        eid = e["employee_id"]
        c = dict.fromkeys(["wd", "wd_today", "present", "wfh", "leave", "comp", "extra", "absent"], 0)
        used: dict[tuple[int, int], int] = {}
        for d in timeutil.daterange(first, end):
            st = res.status(eid, d)
            in_period = d >= start
            working = res.is_working_day(d, eid)
            if in_period and working:
                c["wd"] += 1
                if d <= today:
                    c["wd_today"] += 1
            if st == att.LEAVE:
                if not working:
                    continue
                if types.get((eid, d)) == comp_off_service.COMP_OFF_TYPE:
                    c["comp"] += in_period
                else:
                    used[(d.year, d.month)] = used.get((d.year, d.month), 0) + 1
                    if in_period:
                        c["leave"] += 1
                        c["extra"] += used[(d.year, d.month)] > allowance
            elif in_period and d <= today:
                if st == att.PRESENT:
                    c["present"] += 1
                elif st == att.WFH:
                    c["wfh"] += 1
                elif st == att.NOT_CHECKED_IN and d < today:
                    c["absent"] += 1
        pct = round((c["present"] + c["wfh"]) / c["wd_today"] * 100) if c["wd_today"] else 0
        rows.append({"Employee ID": eid, "Employee": e["name"], "Department": e["department"], "Team Lead": e["team_lead_name"],
                     "Working Days (Period)": c["wd"], "Working Days (Till Today)": c["wd_today"], "Present": c["present"],
                     "WFH": c["wfh"], "Leave": c["leave"], "Comp Off": c["comp"], "Extra Leave": c["extra"],
                     "Not Checked In": c["absent"], "Attendance %": f"{pct}%"})
    rows.sort(key=lambda r: r["Employee"].lower())
    return SUMMARY_COLS, rows


def summary_totals(rows: list[dict]) -> dict:
    t = {"Employee": "TOTAL"}
    for col in SUMMARY_SUM_COLS:
        t[col] = sum(int(r[col]) for r in rows)
    return t


ATT_COLS = ["Employee ID", "Employee", "Department", "Date", "Check-in Time", "Status"]
LEAVE_COLS = ["Employee ID", "Employee", "Department", "Leave Type", "From Date", "To Date", "Reason", "Status",
              "Decided By", "Decision Date", "Rejection Reason"]
WFH_COLS = ["Employee ID", "Employee", "Department", "Date", "Start Time", "Last Verification", "Next Verification",
            "Verification Status", "Latitude", "Longitude"]


def to_csv(columns: list[str], rows: list[dict]) -> bytes:
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=columns, extrasaction="ignore")
    w.writeheader()
    for r in rows:
        w.writerow({k: _safe(v) for k, v in r.items()})
    return ("﻿" + buf.getvalue()).encode("utf-8")


def to_xlsx(columns: list[str], rows: list[dict], title: str) -> bytes:
    buf = io.BytesIO()
    df = pd.DataFrame([{k: _safe(v) for k, v in r.items()} for r in rows], columns=columns)
    with pd.ExcelWriter(buf, engine="openpyxl") as writer:
        df.to_excel(writer, sheet_name=title[:31], index=False)
        ws = writer.sheets[title[:31]]
        for i, col in enumerate(columns, start=1):
            width = max([len(col)] + [len(str(r.get(col, ""))) for r in rows[:200]]) + 2
            ws.column_dimensions[ws.cell(row=1, column=i).column_letter].width = min(width, 50)
    return buf.getvalue()


def _safe(v):
    """Neutralise spreadsheet formula injection from user supplied text."""
    s = "" if v is None else str(v)
    return "'" + s if s[:1] in ("=", "+", "-", "@") and not _is_number(s) else s


def _is_number(s: str) -> bool:
    try:
        float(s)
        return True
    except ValueError:
        return False
