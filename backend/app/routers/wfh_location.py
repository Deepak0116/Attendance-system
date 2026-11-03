from fastapi import APIRouter, Depends, Query

from app.auth.deps import ADMIN, EMPLOYEE, HR, TEAM_LEAD, CurrentUser, require_roles
from app.schemas.models import LocationIn
from app.services import dashboard_service, wfh_service

router = APIRouter(prefix="/wfh", tags=["WFH Location Verification"])


@router.get("/today")
def today(user: CurrentUser = Depends(require_roles(EMPLOYEE, TEAM_LEAD))):
    wfh_service.sweep()
    return wfh_service.my_today(user)


@router.post("/start", status_code=201)
def start(body: LocationIn, user: CurrentUser = Depends(require_roles(EMPLOYEE, TEAM_LEAD))):
    return wfh_service.start(user, body.latitude, body.longitude)


@router.post("/verify")
def verify(body: LocationIn, user: CurrentUser = Depends(require_roles(EMPLOYEE, TEAM_LEAD))):
    return wfh_service.verify(user, body.latitude, body.longitude)


@router.post("/end")
def end(user: CurrentUser = Depends(require_roles(EMPLOYEE, TEAM_LEAD))):
    return wfh_service.end(user)


@router.get("/tracking")
def tracking(from_date: str = Query("", alias="from"), to_date: str = Query("", alias="to"), employee_id: str = "",
             department: str = "", team_lead_id: str = "", status: str = "",
             user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    start, end_d = dashboard_service.resolve_range("custom", from_date, to_date) if from_date and to_date \
        else dashboard_service.resolve_range("today")
    items = wfh_service.sessions(user, start, end_d, employee_id=employee_id, department=department,
                                 team_lead_id=team_lead_id, status=status)
    return {"stats": wfh_service.stats(wfh_service.sessions(user, start, end_d, employee_id=employee_id,
                                                           department=department, team_lead_id=team_lead_id)),
            "items": items}


@router.get("/verifications")
def verifications(employee_id: str, date: str, user: CurrentUser = Depends(require_roles(TEAM_LEAD, HR, ADMIN))):
    return wfh_service.verification_history(user, employee_id, date)
