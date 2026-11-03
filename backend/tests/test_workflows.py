"""End-to-end workflow tests. Tests run in order and share one temporary workbook."""
import threading
from datetime import datetime

import jwt

from app import config
from app.utils import timeutil

MONDAY = datetime(2026, 11, 2, 9, 15, 0)
state: dict = {}


def login(client, username, password):
    r = client.post("/api/auth/login", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def H(client, key):
    if key not in state:
        pw = {"admin": "Admin@123", "hr": "Hr@12345", "tl1": "Tl@12345", "tl2": "Tl@12345"}.get(key, "Emp@12345")
        state[key] = login(client, key, pw)
    return state[key]


def test_01_login_and_auth_errors(client):
    timeutil.set_now(MONDAY)
    assert client.post("/api/auth/login", json={"username": "deepak", "password": "wrong"}).status_code == 401
    assert H(client, "deepak")
    assert client.get("/api/auth/me").status_code == 401
    expired = jwt.encode({"sub": "U0005", "exp": 1}, config.SECRET_KEY, algorithm=config.ALGORITHM)
    r = client.get("/api/auth/me", headers={"Authorization": f"Bearer {expired}"})
    assert r.status_code == 401 and "expired" in r.json()["detail"].lower()


def test_02_checkin_and_duplicate(client):
    r = client.post("/api/attendance/check-in", headers=H(client, "deepak"))
    assert r.status_code == 201 and r.json()["status"] == "Present"
    r = client.post("/api/attendance/check-in", headers=H(client, "deepak"))
    assert r.status_code == 409 and "already checked in" in r.json()["detail"]


def test_03_concurrent_checkin_single_row(client):
    results = []

    def go():
        results.append(client.post("/api/attendance/check-in", headers=H(client, "arun")).status_code)

    threads = [threading.Thread(target=go) for _ in range(6)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert sorted(results) == [201, 409, 409, 409, 409, 409]


def test_04_leave_apply_reject_approve(client):
    d = H(client, "deepak")
    body = {"leave_type": "Casual Leave", "from_date": "2026-11-04", "to_date": "2026-11-05", "reason": "Family function"}
    r = client.post("/api/leave", json=body, headers=d)
    assert r.status_code == 201 and r.json()["status"] == "Pending TL Approval"
    leave_id = r.json()["id"]
    assert client.post("/api/leave", json=body, headers=d).status_code == 409  # overlap
    bad = {**body, "from_date": "2026-11-09", "to_date": "2026-11-08"}
    assert client.post("/api/leave", json=bad, headers=d).status_code == 422
    # wrong TL cannot decide; own-team TL needs reason to reject
    assert client.post(f"/api/leave/{leave_id}/approve", headers=H(client, "tl2")).status_code == 403
    assert client.post(f"/api/leave/{leave_id}/approve", headers=d).status_code == 403
    assert client.post(f"/api/leave/{leave_id}/reject", json={"reason": " "}, headers=H(client, "tl1")).status_code == 422
    r = client.post(f"/api/leave/{leave_id}/reject", json={"reason": "Release week"}, headers=H(client, "tl1"))
    assert r.status_code == 200 and r.json()["status"] == "Rejected" and r.json()["rejection_reason"] == "Release week"
    assert client.post(f"/api/leave/{leave_id}/approve", headers=H(client, "tl1")).status_code == 409
    body2 = {**body, "from_date": "2026-11-06", "to_date": "2026-11-06"}
    new_id = client.post("/api/leave", json=body2, headers=d).json()["id"]
    assert client.post(f"/api/leave/{new_id}/approve", headers=H(client, "hr")).status_code == 403  # HR cannot override by default
    r = client.post(f"/api/leave/{new_id}/approve", headers=H(client, "tl1"))
    assert r.json()["status"] == "Approved" and r.json()["approver_name"] == "Karthik Raja"
    notes = client.get("/api/notifications", headers=d).json()
    assert notes["unread"] >= 2


def test_05_wfh_employee_flow_and_start_verify(client):
    d = H(client, "deepak")
    r = client.post("/api/wfh", json={"from_date": "2026-11-03", "to_date": "2026-11-03", "reason": "Plumber visit"}, headers=d)
    assert r.status_code == 201 and r.json()["status"] == "Pending TL Approval"
    assert client.post(f"/api/wfh/{r.json()['id']}/approve", headers=H(client, "tl1")).json()["status"] == "Approved"
    # not an approved WFH day yet (it is Monday 2 Nov)
    assert client.post("/api/wfh/start", json={"latitude": 13.08, "longitude": 80.27}, headers=d).status_code == 400
    timeutil.set_now(datetime(2026, 11, 3, 9, 15, 0))
    today = client.get("/api/wfh/today", headers=d).json()
    assert today["approved"] and not today["started"] and today["status"] == "Pending Verification"
    assert client.post("/api/attendance/check-in", headers=d).status_code == 400  # must use START WFH
    assert client.post("/api/wfh/verify", json={"latitude": 1, "longitude": 1}, headers=d).status_code == 400
    assert client.post("/api/wfh/start", json={"latitude": 999, "longitude": 80}, headers=d).status_code == 422
    r = client.post("/api/wfh/start", json={"latitude": 13.0827, "longitude": 80.2707}, headers=d)
    assert r.status_code == 201
    j = r.json()
    assert j["started"] and j["status"] == "Verified" and j["next_verification"] == "2026-11-03T13:15:00"
    assert client.post("/api/wfh/start", json={"latitude": 13.0, "longitude": 80.0}, headers=d).status_code == 409
    # four hours later: due, then reminder, then verify
    timeutil.set_now(datetime(2026, 11, 3, 13, 15, 30))
    j = client.get("/api/wfh/today", headers=d).json()
    assert j["status"] == "Verification Due"
    titles = [n["title"] for n in client.get("/api/notifications", headers=d).json()["items"]]
    assert "WFH Verification Required!" in titles
    r = client.post("/api/wfh/verify", json={"latitude": 13.09, "longitude": 80.28}, headers=d)
    assert r.status_code == 200 and r.json()["status"] == "Verified"
    assert r.json()["next_verification"] == "2026-11-03T17:15:30"
    # missed verification alerts admin
    timeutil.set_now(datetime(2026, 11, 3, 19, 0, 0))
    assert client.get("/api/wfh/today", headers=d).json()["status"] == "Missed Verification"
    admin_titles = [n["title"] for n in client.get("/api/notifications", headers=H(client, "admin")).json()["items"]]
    assert "Missed WFH Verification" in admin_titles
    timeutil.set_now(MONDAY)


def test_06_team_lead_own_requests_go_to_hr(client):
    tl = H(client, "tl1")
    r = client.post("/api/leave", json={"leave_type": "Sick Leave", "from_date": "2026-11-10", "to_date": "2026-11-11", "reason": "Fever"}, headers=tl)
    assert r.status_code == 201 and r.json()["status"] == "Pending HR Approval"
    lid = r.json()["id"]
    assert client.post(f"/api/leave/{lid}/approve", headers=tl).status_code == 403  # no self approval
    assert client.post(f"/api/leave/{lid}/approve", headers=H(client, "tl2")).status_code == 403
    assert client.post(f"/api/leave/{lid}/approve", headers=H(client, "deepak")).status_code == 403
    pending = client.get("/api/requests/pending", headers=H(client, "hr")).json()
    assert any(p["id"] == lid for p in pending)
    assert client.post(f"/api/leave/{lid}/approve", headers=H(client, "hr")).json()["status"] == "Approved"
    w = client.post("/api/wfh", json={"from_date": "2026-11-12", "to_date": "2026-11-12", "reason": "Internet install"}, headers=tl).json()
    assert w["status"] == "Pending HR Approval"
    assert client.post(f"/api/wfh/{w['id']}/reject", json={"reason": "Client meeting"}, headers=H(client, "hr")).json()["status"] == "Rejected"
    hr_titles = [n["title"] for n in client.get("/api/notifications", headers=H(client, "hr")).json()["items"]]
    assert any("Team Lead leave request" in t for t in hr_titles)


def test_07_team_isolation_and_location_privacy(client):
    timeutil.set_now(datetime(2026, 11, 3, 12, 0, 0))
    emps = client.get("/api/employees", headers=H(client, "tl1")).json()
    assert {e["name"] for e in emps} == {"Deepak", "Arun", "Priya"}
    emps2 = client.get("/api/employees", headers=H(client, "tl2")).json()
    assert {e["name"] for e in emps2} == {"Sana Khan"}
    assert client.get("/api/employees/EMP008", headers=H(client, "tl1")).status_code == 403
    track = client.get("/api/wfh/tracking?from=2026-11-03&to=2026-11-03", headers=H(client, "tl1")).json()
    assert [i["employee_name"] for i in track["items"]] == ["Deepak"]
    assert "latitude" not in track["items"][0]
    assert client.get("/api/wfh/tracking?from=2026-11-03&to=2026-11-03", headers=H(client, "tl2")).json()["items"] == []
    hr_track = client.get("/api/wfh/tracking?from=2026-11-03&to=2026-11-03", headers=H(client, "hr")).json()
    assert hr_track["items"][0]["latitude"] and hr_track["stats"]["total"] == 1
    ver = client.get("/api/wfh/verifications?employee_id=EMP005&date=2026-11-03", headers=H(client, "tl1")).json()
    assert len(ver) == 2 and "latitude" not in ver[0]
    assert client.get("/api/wfh/verifications?employee_id=EMP005&date=2026-11-03", headers=H(client, "tl2")).status_code == 403
    ver = client.get("/api/wfh/verifications?employee_id=EMP005&date=2026-11-03", headers=H(client, "admin")).json()
    assert ver[0]["latitude"]
    timeutil.set_now(MONDAY)


def test_08_role_access_and_admin(client):
    e = H(client, "deepak")
    for url in ("/api/employees", "/api/reports/attendance", "/api/settings", "/api/wfh/tracking", "/api/requests/pending"):
        assert client.get(url, headers=e).status_code == 403, url
    assert client.post("/api/employees", json={}, headers=H(client, "hr")).status_code == 403
    assert client.get("/api/employees", headers={}).status_code == 401
    admin = H(client, "admin")
    assert len(client.get("/api/employees", headers=admin).json()) == 11
    body = {"name": "New Person", "email": "new@astenlabs.com", "department": "QA", "designation": "Tester", "role": "Employee",
            "team_lead_id": "EMP003", "password": "Welcome@123", "username": "newp"}
    assert client.post("/api/employees", json={**body, "team_lead_id": ""}, headers=admin).status_code == 422
    r = client.post("/api/employees", json=body, headers=admin)
    assert r.status_code == 201 and r.json()["team_lead_name"] == "Karthik Raja"
    assert client.post("/api/employees", json=body, headers=admin).status_code == 409
    eid = r.json()["employee_id"]
    assert client.post(f"/api/employees/{eid}/status", json={"active": False}, headers=admin).status_code == 200
    assert client.post("/api/auth/login", json={"username": "newp", "password": "Welcome@123"}).status_code == 403
    assert client.post("/api/employees/EMP003/status", json={"active": False}, headers=admin).status_code == 409
    stats = client.get("/api/dashboard/stats?range=month", headers=admin).json()
    assert stats["total_employees"] == 10 and "departments" in stats and "recent_activities" in stats
    assert client.get("/api/dashboard/stats", headers=H(client, "tl1")).json()["total_employees"] == 3


def test_09_reports_and_exports(client):
    hr = H(client, "hr")
    q = "from=2026-11-01&to=2026-11-30"
    j = client.get(f"/api/reports/leave?{q}", headers=hr).json()
    assert len(j["rows"]) >= 3
    csv = client.get(f"/api/reports/attendance?{q}&format=csv", headers=hr)
    assert csv.status_code == 200 and "Employee ID" in csv.text
    x = client.get(f"/api/reports/wfh?{q}&format=xlsx", headers=hr)
    assert x.status_code == 200 and x.content[:2] == b"PK"


def test_10_settings(client):
    admin = H(client, "admin")
    assert client.put("/api/settings", json={"settings": {"wfh_verification_interval_hours": "abc"}}, headers=admin).status_code == 422
    assert client.put("/api/settings", json={"settings": {"location_retention_days": "30"}}, headers=admin).status_code == 200
    assert client.put("/api/settings", json={"settings": {"location_retention_days": "30"}}, headers=H(client, "hr")).status_code == 403


def test_11_second_fourth_saturday_holiday_support_comp_off(client):
    pw = "Emp@12345"
    # Saturday 7 Nov 2026 is the FIRST Saturday: a normal working day for Development.
    timeutil.set_now(datetime(2026, 11, 7, 10, 0, 0))
    assert client.post("/api/attendance/check-in", headers=H(client, "deepak")).status_code == 201
    # Saturday 14 Nov 2026 is the SECOND Saturday: holiday for Development, but Support works (7-day week).
    timeutil.set_now(datetime(2026, 11, 14, 10, 0, 0))
    r = client.post("/api/attendance/check-in", headers=H(client, "arun"))
    assert r.status_code == 400 and "not a working day" in r.json()["detail"]
    ravi = login(client, "ravi", pw)
    assert client.post("/api/attendance/check-in", headers=ravi).status_code == 201
    co = client.get("/api/comp-off/my", headers=ravi).json()
    assert co["balance"] == 1 and co["ledger"][0]["work_date"] == "2026-11-14"
    # Support working on the first Saturday (a normal Saturday) earns nothing; Sunday earns a credit.
    assert client.get("/api/comp-off/my", headers=login(client, "anita", pw)).json()["balance"] == 0
    timeutil.set_now(datetime(2026, 11, 21, 10, 0, 0))   # third Saturday - ordinary working Saturday
    anita = login(client, "anita", pw)
    assert client.post("/api/attendance/check-in", headers=anita).status_code == 201
    assert client.get("/api/comp-off/my", headers=anita).json()["balance"] == 0
    timeutil.set_now(datetime(2026, 11, 22, 10, 0, 0))   # Sunday - weekly off, Support works
    assert client.post("/api/attendance/check-in", headers=anita).status_code == 201
    assert client.get("/api/comp-off/my", headers=anita).json()["balance"] == 1
    # Redeem: a request needs enough balance and reserves credits while pending
    timeutil.set_now(datetime(2026, 11, 23, 10, 0, 0))
    body = {"leave_type": "Comp Off", "from_date": "2026-11-26", "to_date": "2026-11-26", "reason": "Comp off for weekend work"}
    assert client.post("/api/leave", json={**body, "to_date": "2026-11-27"}, headers=ravi).status_code == 409  # 2 days > 1 credit
    sana = login(client, "sana", pw)
    assert client.post("/api/leave", json=body, headers=sana).status_code == 409  # no balance
    r = client.post("/api/leave", json=body, headers=ravi)
    assert r.status_code == 201 and r.json()["status"] == "Pending TL Approval"
    assert client.get("/api/comp-off/my", headers=ravi).json()["available_to_request"] == 0
    assert client.post(f"/api/leave/{r.json()['id']}/approve", headers=login(client, "tl3", "Tl@12345")).json()["status"] == "Approved"
    after = client.get("/api/comp-off/my", headers=ravi).json()
    assert after["balance"] == 0 and after["ledger"][0]["status"] == "Used"
    assert client.get("/api/comp-off", headers=H(client, "tl1")).json() == []
    assert len(client.get("/api/comp-off", headers=H(client, "hr")).json()) == 2
    # settings validation
    assert client.put("/api/settings", json={"settings": {"holiday_saturdays": "2,9"}}, headers=H(client, "admin")).status_code == 422
    timeutil.set_now(MONDAY)


def test_12_checkin_punctuality_messages(client):
    # office start 09:30, grace 15 min, early = 30+ min before
    from app.services import attendance_service as att
    cases = {"2026-11-30T08:45:00": "early", "2026-11-30T09:05:00": "on_time", "2026-11-30T09:30:00": "on_time",
             "2026-11-30T09:45:00": "on_time", "2026-11-30T09:46:00": "late", "2026-11-30T11:10:00": "late"}
    for ts, expected in cases.items():
        assert att.punctuality(ts)["punctuality"] == expected, ts
    assert att.punctuality("2026-11-30T09:00:00")["minutes_early"] == 30
    assert att.punctuality("2026-11-30T09:00:00")["punctuality"] == "early"
    # the API returns it on check-in (Priya checks in at 09:15 on Monday 2 Nov -> on time)
    timeutil.set_now(datetime(2026, 11, 2, 9, 15, 0))
    r = client.post("/api/attendance/check-in", headers=H(client, "priya"))
    assert r.status_code == 201 and r.json()["punctuality"] == "on_time"
    assert client.get("/api/attendance/today", headers=H(client, "priya")).json()["punctuality"] == "on_time"
    assert client.put("/api/settings", json={"settings": {"office_start_time": "9am"}}, headers=H(client, "admin")).status_code == 422
    timeutil.set_now(MONDAY)


def test_13_remember_login_and_arrival(client):
    import jwt as pyjwt
    from datetime import timezone
    short = client.post("/api/auth/login", json={"username": "arun", "password": "Emp@12345"}).json()["access_token"]
    long = client.post("/api/auth/login", json={"username": "arun", "password": "Emp@12345", "remember": True}).json()["access_token"]
    exp = lambda t: pyjwt.decode(t, config.SECRET_KEY, algorithms=[config.ALGORITHM])["exp"]
    assert exp(long) - exp(short) > 20 * 24 * 3600  # remembered sign-in lasts weeks, normal one hours
    timeutil.set_now(datetime(2026, 12, 7, 8, 40, 0))
    assert client.get("/api/attendance/today", headers={"Authorization": f"Bearer {long}"}).json()["arrival"] == "early"
    timeutil.set_now(datetime(2026, 12, 7, 10, 30, 0))
    assert client.get("/api/attendance/today", headers={"Authorization": f"Bearer {long}"}).json()["arrival"] == "late"
    timeutil.set_now(MONDAY)


def test_14_notifications_carry_a_link_to_the_request(client):
    timeutil.set_now(datetime(2026, 12, 8, 9, 0, 0))
    ar = H(client, "arun")
    r = client.post("/api/leave", json={"leave_type": "Casual Leave", "from_date": "2026-12-14", "to_date": "2026-12-14", "reason": "Personal work"}, headers=ar)
    rid = r.json()["id"]
    tl_notes = client.get("/api/notifications", headers=H(client, "tl1")).json()["items"]
    mine = [n for n in tl_notes if n["link"] == f"/pending?request={rid}&type=leave"]
    assert len(mine) == 1
    client.post(f"/api/leave/{rid}/approve", headers=H(client, "tl1"))
    emp_notes = client.get("/api/notifications", headers=ar).json()["items"]
    assert any(n["link"] == f"/my-requests?request={rid}&type=leave" and n["title"] == "Leave Approved" for n in emp_notes)
    timeutil.set_now(MONDAY)


def test_15_tl_gets_notification_when_hr_rejects_or_approves(client):
    timeutil.set_now(datetime(2026, 12, 9, 9, 0, 0))
    tl = H(client, "tl2")
    lid = client.post("/api/leave", json={"leave_type": "Casual Leave", "from_date": "2026-12-15", "to_date": "2026-12-15", "reason": "Personal work"}, headers=tl).json()["id"]
    r = client.post(f"/api/leave/{lid}/reject", json={"reason": "Project deadline"}, headers=H(client, "hr"))
    assert r.status_code == 200 and r.json()["status"] == "Rejected"
    notes = client.get("/api/notifications", headers=tl).json()
    rej = [n for n in notes["items"] if n["title"] == "Leave Rejected"]
    assert len(rej) == 1 and "Project deadline" in rej[0]["message"] and rej[0]["link"] == f"/my-requests?request={lid}&type=leave"
    assert notes["unread"] >= 1
    wid = client.post("/api/wfh", json={"from_date": "2026-12-16", "to_date": "2026-12-16", "reason": "Internet install"}, headers=tl).json()["id"]
    client.post(f"/api/wfh/{wid}/approve", headers=H(client, "hr"))
    assert any(n["title"] == "WFH Approved" for n in client.get("/api/notifications", headers=tl).json()["items"])
    timeutil.set_now(MONDAY)


def test_16_weekly_and_monthly_summary_report(client):
    hr = H(client, "hr")
    # Month of 2026-11 (others tests created leave, WFH and check-ins in Nov 2026)
    timeutil.set_now(datetime(2026, 12, 1, 12, 0, 0))
    r = client.get("/api/reports/summary?from=2026-11-01&to=2026-11-30", headers=hr)
    assert r.status_code == 200
    j = r.json()
    assert j["columns"][:3] == ["Employee ID", "Employee", "Department"]
    by = {row["Employee"]: row for row in j["rows"]}
    assert "Admin" not in " ".join(by) and "Deepak" in by and "Ravi Shankar" in by
    deepak = by["Deepak"]
    assert deepak["Working Days (Period)"] >= 20 and deepak["WFH"] == 1 and deepak["Leave"] >= 1
    # Ravi (Support, 7-day) has more working days than a 5.5-day department and one Comp Off used, never counted as extra
    assert by["Ravi Shankar"]["Working Days (Period)"] > deepak["Working Days (Period)"]
    assert by["Ravi Shankar"]["Comp Off"] == 1 and by["Ravi Shankar"]["Extra Leave"] == 0
    assert j["totals"]["Employee"] == "TOTAL" and j["totals"]["WFH"] == sum(x["WFH"] for x in j["rows"])
    # Weekly: second week of Nov 2026 (Mon 9 - Sun 15)
    w = client.get("/api/reports/summary?from=2026-11-09&to=2026-11-15", headers=hr).json()
    assert {row["Employee"] for row in w["rows"]} == set(by)
    assert max(row["Working Days (Period)"] for row in w["rows"]) <= 7
    # Extra leave: allowance 1/month. Deepak's second leave day in the same month must count as extra.
    ex = client.get("/api/reports/summary?from=2026-11-01&to=2026-11-30", headers=hr).json()["rows"]
    csv = client.get("/api/reports/summary?from=2026-11-01&to=2026-11-30&format=csv", headers=hr)
    assert csv.status_code == 200 and "TOTAL" in csv.text and "Extra Leave" in csv.text
    x = client.get("/api/reports/summary?from=2026-11-01&to=2026-11-30&format=xlsx", headers=hr)
    assert x.content[:2] == b"PK"
    assert client.get("/api/reports/summary", headers=H(client, "tl1")).status_code == 403
    assert isinstance(ex, list)
    timeutil.set_now(MONDAY)


def test_17_reporting_key_for_power_bi(client):
    admin, hr = H(client, "admin"), H(client, "hr")
    assert client.get("/api/report-key", headers=hr).status_code == 403
    key = client.get("/api/report-key", headers=admin).json()["key"]
    assert key.startswith("alr_") and len(key) > 30
    ok = client.get("/api/reports/summary?period=last_month&format=csv", headers={"X-Report-Key": key})
    assert ok.status_code == 200 and "Extra Leave" in ok.text and "TOTAL" in ok.text
    assert client.get(f"/api/reports/summary?period=this_month&format=json&key={key}").status_code == 200  # ?key= also works
    for p in ("this_week", "last_week", "this_month", "last_month"):
        assert client.get(f"/api/reports/attendance?period={p}&format=json", headers={"X-Report-Key": key}).status_code == 200
    assert client.get("/api/reports/summary?period=someday", headers={"X-Report-Key": key}).status_code == 422
    assert client.get("/api/reports/summary", headers={"X-Report-Key": "alr_wrong"}).status_code == 401
    # the key is read-only and report-only
    for url in ("/api/employees", "/api/settings", "/api/dashboard/stats", "/api/requests/pending", "/api/notifications"):
        assert client.get(url, headers={"X-Report-Key": key}).status_code == 401, url
    assert client.post("/api/leave", json={}, headers={"X-Report-Key": key}).status_code == 401
    # never exposes precise WFH coordinates
    timeutil.set_now(datetime(2026, 12, 1, 12, 0, 0))
    wfh = client.get("/api/reports/wfh?from=2026-11-01&to=2026-11-30&format=json", headers={"X-Report-Key": key}).json()
    assert wfh["rows"] and all(r["Latitude"] == "" and r["Longitude"] == "" for r in wfh["rows"])
    timeutil.set_now(MONDAY)
    # rotating invalidates the old key
    new = client.post("/api/report-key/rotate", headers=admin).json()["key"]
    assert new != key
    assert client.get("/api/reports/summary", headers={"X-Report-Key": key}).status_code == 401
    assert client.get("/api/reports/summary", headers={"X-Report-Key": new}).status_code == 200
    # a normal HR login still works without a key
    assert client.get("/api/reports/summary", headers=hr).status_code == 200


def test_18_every_person_sheet_has_employee_id(client):
    from app.utils.excel_store import store
    for sheet in ("Users", "Employees", "Attendance", "Leave Requests", "WFH Requests", "WFH Verifications",
                  "Notifications", "Approval History", "Comp Off Ledger"):
        rows = store.rows(sheet)
        assert rows, sheet
        assert all(r["Employee ID"].startswith("EMP") for r in rows), (sheet, [r for r in rows if not r["Employee ID"].startswith("EMP")][:1])
    users = {u["User ID"]: u["Employee ID"] for u in store.rows("Users")}
    emps = {e["User ID"]: e["Employee ID"] for e in store.rows("Employees")}
    assert users == emps
    # all four report exports lead with Employee ID
    for kind in ("attendance", "leave", "wfh", "summary"):
        cols = client.get(f"/api/reports/{kind}?from=2026-11-01&to=2026-11-30", headers=H(client, "hr")).json()["columns"]
        assert cols[0] == "Employee ID", kind


def test_19_last_5_days_period(client):
    from app.routers.misc import period_dates
    from app.services.dashboard_service import resolve_range
    timeutil.set_now(datetime(2026, 12, 10, 12, 0, 0))
    a, b = period_dates("last_5_days")
    assert (a.isoformat(), b.isoformat()) == ("2026-12-06", "2026-12-10")
    assert resolve_range("last5") == (a, b)
    hr = H(client, "hr")
    for kind in ("attendance", "leave", "wfh", "summary"):
        r = client.get(f"/api/reports/{kind}?period=last_5_days&format=json", headers=hr)
        assert r.status_code == 200, kind
    assert client.get("/api/dashboard/stats?range=last5", headers=hr).json()["range"]["days"] == 5
    timeutil.set_now(MONDAY)


def test_20_approved_leave_cancels_wfh(client):
    pr, tl = H(client, "priya"), H(client, "tl1")
    timeutil.set_now(datetime(2026, 12, 14, 9, 0, 0))
    # WFH approved for 21-23 Dec; then leave approved for 22 Dec only -> WFH stays but not on the leave day
    w1 = client.post("/api/wfh", json={"from_date": "2026-12-21", "to_date": "2026-12-23", "reason": "Home repairs"}, headers=pr).json()["id"]
    assert client.post(f"/api/wfh/{w1}/approve", headers=tl).json()["status"] == "Approved"
    l1 = client.post("/api/leave", json={"leave_type": "Casual Leave", "from_date": "2026-12-22", "to_date": "2026-12-22", "reason": "Family event"}, headers=pr)
    assert l1.status_code == 201  # leave may be requested over an approved WFH
    assert client.post(f"/api/leave/{l1.json()['id']}/approve", headers=tl).json()["status"] == "Approved"
    assert [r for r in client.get("/api/wfh/my", headers=pr).json() if r["id"] == w1][0]["status"] == "Approved"
    timeutil.set_now(datetime(2026, 12, 21, 9, 10, 0))
    assert client.get("/api/wfh/today", headers=pr).json()["approved"] is True
    timeutil.set_now(datetime(2026, 12, 22, 9, 10, 0))
    assert client.get("/api/wfh/today", headers=pr).json()["approved"] is False
    assert client.post("/api/wfh/start", json={"latitude": 13.0, "longitude": 80.0}, headers=pr).status_code == 400
    today = client.get("/api/attendance/today", headers=pr).json()
    assert today["on_leave"] is True and today["wfh_approved"] is False
    assert client.post("/api/attendance/check-in", headers=pr).status_code == 400
    track = client.get("/api/wfh/tracking?from=2026-12-22&to=2026-12-22", headers=tl).json()
    assert all(i["employee_name"] != "Priya" for i in track["items"])
    # WFH fully inside the leave -> cancelled, employee and Team Lead are told
    timeutil.set_now(datetime(2026, 12, 14, 9, 0, 0))
    w2 = client.post("/api/wfh", json={"from_date": "2026-12-28", "to_date": "2026-12-28", "reason": "Internet install"}, headers=pr).json()["id"]
    client.post(f"/api/wfh/{w2}/approve", headers=tl)
    l2 = client.post("/api/leave", json={"leave_type": "Casual Leave", "from_date": "2026-12-27", "to_date": "2026-12-29", "reason": "Trip"}, headers=pr).json()["id"]
    client.post(f"/api/leave/{l2}/approve", headers=tl)
    got = [r for r in client.get("/api/wfh/my", headers=pr).json() if r["id"] == w2][0]
    assert got["status"] == "Cancelled" and "leave was approved" in got["rejection_reason"]
    assert any(n["title"] == "WFH Cancelled" and n["link"].startswith("/my-requests") for n in client.get("/api/notifications", headers=pr).json()["items"])
    assert any(n["title"] == "WFH Cancelled" for n in client.get("/api/notifications", headers=tl).json()["items"])
    # a cancelled WFH no longer blocks a new request for the same day
    assert client.post("/api/wfh", json={"from_date": "2026-12-28", "to_date": "2026-12-28", "reason": "Again"}, headers=pr).status_code == 201
    timeutil.set_now(MONDAY)
