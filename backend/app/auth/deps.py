from typing import Callable

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.auth.security import decode_token
from app.utils.excel_store import store

EMPLOYEE, TEAM_LEAD, HR, ADMIN = "Employee", "Team Lead", "HR", "Admin"
ROLES = [EMPLOYEE, TEAM_LEAD, HR, ADMIN]

bearer = HTTPBearer(auto_error=False)
CurrentUser = dict


def _unauthorized(detail: str) -> HTTPException:
    return HTTPException(status.HTTP_401_UNAUTHORIZED, detail, headers={"WWW-Authenticate": "Bearer"})


def build_current_user(user: dict) -> CurrentUser:
    emp = store.find("Employees", **{"User ID": user["User ID"]})
    emp = emp[0] if emp else {}
    return {
        "user_id": user["User ID"],
        "username": user["Username"],
        "role": user["Role"],
        "employee_id": emp.get("Employee ID", ""),
        "name": emp.get("Name", user["Username"]),
        "email": emp.get("Email", ""),
        "department": emp.get("Department", ""),
        "designation": emp.get("Designation", ""),
        "team_lead_id": emp.get("Team Lead ID", ""),
    }


def get_current_user(creds: HTTPAuthorizationCredentials | None = Depends(bearer)) -> CurrentUser:
    if creds is None:
        raise _unauthorized("Not authenticated")
    try:
        payload = decode_token(creds.credentials)
    except jwt.ExpiredSignatureError:
        raise _unauthorized("Your session has expired. Please sign in again.")
    except jwt.InvalidTokenError:
        raise _unauthorized("Invalid authentication token")
    user = store.get("Users", "User ID", payload.get("sub", ""))
    if not user or user["Active Status"] != "Active":
        raise _unauthorized("Account not found or deactivated")
    return build_current_user(user)


def require_roles(*roles: str) -> Callable[[CurrentUser], CurrentUser]:
    def checker(user: CurrentUser = Depends(get_current_user)) -> CurrentUser:
        if user["role"] not in roles:
            raise HTTPException(status.HTTP_403_FORBIDDEN, "You do not have permission to perform this action")
        return user

    return checker
