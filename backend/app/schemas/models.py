from pydantic import BaseModel, Field, field_validator

ROLE_VALUES = ("Employee", "Team Lead", "HR", "Admin")


class LoginIn(BaseModel):
    username: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=128)
    remember: bool = False


class ChangePasswordIn(BaseModel):
    current_password: str
    new_password: str = Field(min_length=8, max_length=128)


class LeaveIn(BaseModel):
    leave_type: str = Field(min_length=1, max_length=64)
    from_date: str
    to_date: str
    reason: str = Field(min_length=3, max_length=500)


class WfhIn(BaseModel):
    from_date: str
    to_date: str
    reason: str = Field(min_length=3, max_length=500)


class RejectIn(BaseModel):
    reason: str = Field(default="", max_length=500)


class LocationIn(BaseModel):
    latitude: float
    longitude: float
    accuracy: float | None = None


class EmployeeIn(BaseModel):
    name: str = Field(min_length=2, max_length=100)
    email: str = Field(pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$", max_length=120)
    phone: str = Field(default="", max_length=20)
    department: str = Field(min_length=1, max_length=80)
    designation: str = Field(default="", max_length=80)
    role: str
    team_lead_id: str = ""
    joining_date: str = ""
    username: str = Field(default="", max_length=64)
    password: str = Field(default="", max_length=128)

    @field_validator("role")
    @classmethod
    def valid_role(cls, v: str) -> str:
        if v not in ROLE_VALUES:
            raise ValueError("Invalid role")
        return v


class StatusIn(BaseModel):
    active: bool


class NameIn(BaseModel):
    name: str = Field(min_length=1, max_length=80)
    active: bool = True
    working_days: str | None = Field(default=None, max_length=40)


class SettingsIn(BaseModel):
    settings: dict[str, str]
