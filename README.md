# Employee Attendance, Leave & WFH Management System

React + TypeScript (Vite) · FastAPI · Excel (Pandas + OpenPyXL) · JWT · Browser Geolocation

```
React frontend  ->  REST API + JWT  ->  FastAPI  ->  Pandas + OpenPyXL  ->  attendance_system.xlsx
```

## Folder structure

```
attendance-system/
├── backend/
│   ├── app/
│   │   ├── main.py            FastAPI app, error handlers, background sweeper
│   │   ├── config.py          env configuration
│   │   ├── seed.py            creates workbook, departments, leave types, demo users
│   │   ├── auth/              JWT + bcrypt, role dependencies
│   │   ├── routers/           auth, employees, attendance, requests, wfh_location, misc
│   │   ├── services/          attendance, requests (routing/approval), wfh, dashboard, reports...
│   │   ├── schemas/           Pydantic request models
│   │   └── utils/             excel_store.py (locking), timeutil.py
│   ├── data/attendance_system.xlsx   (auto-created on first start)
│   └── tests/                 pytest end-to-end workflow tests
└── frontend/
    └── src/ components · pages · services · hooks · context · types · utils
```

## Setup

### Backend (Python 3.11+)
```bash
cd backend
python -m venv .venv
.venv\Scripts\activate          # macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```
API docs: http://localhost:8000/docs

### Frontend (Node 18+)
```bash
cd frontend
npm install
npm run dev                     # http://localhost:5173 (proxies /api to :8000)
```
Production build: `npm run build` (output in `frontend/dist`).

### Environment variables (backend, all optional)
| Variable | Default | Purpose |
|---|---|---|
| `JWT_SECRET` | dev value | **Set a long random value in production** |
| `JWT_EXPIRE_MINUTES` | 480 | Token lifetime |
| `ATTENDANCE_DATA_FILE` | `backend/data/attendance_system.xlsx` | Workbook location |
| `CORS_ORIGINS` | `http://localhost:5173,...` | Allowed origins |
| `ADMIN_PASSWORD` | random | Initial Admin password on the very first start |

Frontend: `VITE_API_TARGET` changes the dev-proxy target.

## First start and accounts
There is no demo data. The first start creates the workbook with departments (Armada, Support Armada, Human Resources, Administration), leave types and one **Admin** account. The admin password is random and saved to `backend/data/initial_admin_password.txt` (or set `ADMIN_PASSWORD` before the first start). Delete that file after changing the password on the Profile page.

Load the current staff with `backend\.venv\Scripts\python.exe backend\scripts\load_staff.py` (edit the `STAFF` list in that script first if people change). Each new person gets a random password saved in `backend/data/initial_credentials.txt` - hand these out, then delete the file. Everyone can change their password on the Profile page; Admin can reset anyone's from Employees -> Edit.

## Key behaviour

- **Approval routing**: Employee -> assigned Team Lead; Team Lead -> HR. Nobody can decide their own request. HR can only decide employee requests if `hr_override_enabled` is on; Admin override is `admin_override_enabled`.
- **Check-in**: manual, once per day, enforced by the backend inside a locked transaction. Blocked on leave days, approved-WFH days (use START WFH) and non-working days (Settings -> working days; default Mon-Fri).
- **WFH location**: captured only when the employee presses START WFH / VERIFY LOCATION after a consent screen. No background or continuous tracking. Next verification = last verification + interval (default 4 h, configurable). The in-app reminder appears while the app is open; optional browser notifications need the user's permission. "Remind me later" snoozes 15 minutes.
- **WFH statuses**: Verified, Verification Due, Pending Verification, Missed Verification, Completed (due -> missed after the configurable grace period; admins and the team lead are notified).
- **Privacy**: only HR/Admin receive latitude/longitude. Coordinates older than `location_retention_days` are erased automatically (Settings, Admin only).
- **Excel safety**: every write goes through `utils/excel_store.py`: in-process lock + cross-process file lock, reload if the file changed, validation, write to a temp file and atomic `os.replace`, rollback on error. If the workbook is open and locked in Excel the API returns HTTP 503 with a clear message. Do not edit the workbook by hand while the server is writing.

## Tests
```bash
cd backend
pytest -q
```
Covers: login/JWT expiry, check-in + duplicate + concurrent check-in, leave apply/overlap/reject (reason required)/approve, WFH request + approve, TL own leave/WFH -> HR, WFH start/4-hour due/re-verify/missed alert, TL team isolation, HR/Admin visibility, location privacy, role-based 403/401, employee CRUD, reports (JSON/CSV/XLSX), settings.

Manual checklist for the browser parts (geolocation permission prompt, denied/unavailable/timeout messages, responsive layout) is in the section below.

## Manual browser checklist
1. Employee: sign in -> Check In Now -> success card; reload -> "already checked in".
2. Employee: request WFH for today; TL approves; employee sees "Work From Home" card -> START WFH -> consent -> browser prompt.
3. Block the permission once to see the friendly error; allow and see "WFH Started Successfully!" with next verification time.
4. In Settings set the verification interval to 1 hour (Admin) to see the reminder sooner, or wait for the due time.
5. TL: WFH Tracking shows only the team; HR/Admin: WFH Overview -> View shows the map and coordinates.

## Support team (7-day week) and Comp Off
- Each department can have its own working week (Settings -> Departments & Working Days). The demo **Support** department works all 7 days; other departments use the company default (Mon-Fri).
- When an employee checks in (or starts WFH) on a day outside the standard company week but inside their department's week - e.g. Support on Saturday/Sunday - they automatically earn **1 comp-off credit**.
- Credits are redeemed by applying leave with type **Comp Off** (needs enough balance; pending requests reserve credits). The credit is consumed (oldest first) when the Team Lead/HR approves. Credits expire after `comp_off_expiry_days` (default 90, Admin setting).
- Employees see the balance on the dashboard and Leave page; HR/Admin see all credits under Leave Overview. The **Support Armada** department is set up as a 7-day team.

## Holidays: 2nd and 4th Saturday
The standard week is Monday-Saturday, and the Saturdays listed in the `holiday_saturdays` setting (default `2,4`) are holidays. Change it in Settings (e.g. `1,3` or blank for none). Holiday Saturdays and Sundays are non-working days for normal departments (no check-in, not counted as working days, no "Not Checked In"). The Support department (7-day week) still works them and earns 1 comp-off credit for each holiday Saturday / Sunday worked.

## Welcome card messages
The greeting follows the time of day, with a "Thought for today" that changes daily. After check-in a friendly message is shown depending on the time: early (encouraging), on time, or late (kind, no blame). Settings: `office_start_time` (default 09:30), `late_grace_minutes` (15) and `early_checkin_minutes` (30). It is a message only - it does not change the attendance status.

## Start-up welcome popup
A small popup opens by itself when an employee turns on the computer and signs in to Windows. It greets them by name, shows the "Thought for today" and wording that matches their arrival time (early / on time / late), and has **Check In Now** and **Later** buttons. It is hidden-style (a short message that closes itself) on leave days and holidays, and shows **Start WFH** on approved WFH days.
- Page: `/welcome` (compact window). The popup remembers its own sign-in on that computer for `JWT_REMEMBER_DAYS` days (default 30), separately from the normal app. Use "Not you? Sign out" on shared computers.
- Install on each computer (PowerShell, no admin): `startup\install-startup.ps1` (add `-Url "https://your-server/welcome"` for a deployed server). It puts a shortcut in the Windows Startup folder that opens the popup in a small Edge/Chrome app window. Remove with `startup\uninstall-startup.ps1`.
- Check-in is still a manual click; the popup never checks anyone in by itself.

## Several users at once
Each browser tab keeps its own sign-in (nothing is shared between tabs), so open a new tab (Ctrl+T) for each user and sign in there. Do not use "Duplicate tab", which copies the current sign-in.

## Power BI (automatic weekly / monthly report)
Admin -> Settings -> **Power BI reporting key** shows a read-only key (also in `backend/data/report_api_key.txt`, or set `REPORT_API_KEY`). It can only fetch `/api/reports/...` and never returns precise WFH locations. Send it as the HTTP header `X-Report-Key` (a `?key=` query parameter also works but can end up in logs).
- Monthly report: `GET /api/reports/summary?period=last_month&format=csv` (`period` = `this_week`, `last_week`, `this_month`, `last_month`; or `from=YYYY-MM-DD&to=YYYY-MM-DD`). Other kinds: `attendance`, `leave`, `wfh`. Formats: `csv`, `xlsx`, `json`.
- Power BI Desktop: Get Data -> Web -> Advanced, add header `X-Report-Key`. Copy-paste Power Query code is shown on the Settings card.
- Scheduled refresh in Power BI Service needs the on-premises data gateway on the computer running this app (the address is local). "Create new key" immediately invalidates the old key.
