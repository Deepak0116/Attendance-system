from fastapi import APIRouter, Depends, HTTPException

from app.auth.deps import CurrentUser, get_current_user
from app.auth.security import create_access_token, hash_password, verify_password
from app.schemas.models import ChangePasswordIn, LoginIn
from app.services import directory
from app.utils.excel_store import store

router = APIRouter(prefix="/auth", tags=["Authentication"])


def me_dto(user: CurrentUser) -> dict:
    emp = directory.get_employee(user["employee_id"]) or {}
    return {**user, "phone": emp.get("phone", ""), "joining_date": emp.get("joining_date", ""),
            "team_lead_name": emp.get("team_lead_name", "")}


@router.post("/login")
def login(body: LoginIn):
    users = [u for u in store.rows("Users") if u["Username"].lower() == body.username.strip().lower()]
    user = users[0] if users else None
    if not user or not verify_password(body.password, user["Password Hash"]):
        raise HTTPException(401, "Invalid username or password")
    if user["Active Status"] != "Active":
        raise HTTPException(403, "Your account has been deactivated. Please contact the administrator.")
    from app.auth.deps import build_current_user
    cu = build_current_user(user)
    return {"access_token": create_access_token(user["User ID"], user["Role"], body.remember), "token_type": "bearer", "user": me_dto(cu)}


@router.get("/me")
def me(user: CurrentUser = Depends(get_current_user)):
    return me_dto(user)


@router.post("/change-password")
def change_password(body: ChangePasswordIn, user: CurrentUser = Depends(get_current_user)):
    with store.transaction():
        row = store.get("Users", "User ID", user["user_id"])
        if not verify_password(body.current_password, row["Password Hash"]):
            raise HTTPException(400, "Current password is incorrect")
        store.update("Users", "User ID", user["user_id"], {"Password Hash": hash_password(body.new_password)})
    return {"message": "Password updated"}
