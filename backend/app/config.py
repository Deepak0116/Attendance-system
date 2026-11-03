import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DATA_FILE = Path(os.getenv("ATTENDANCE_DATA_FILE", BASE_DIR / "data" / "attendance_system.xlsx"))
SECRET_KEY = os.getenv("JWT_SECRET", "change-this-secret-in-production-use-a-long-random-string")
ALGORITHM = "HS256"
TOKEN_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))
CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")]
SEED_DEMO_DATA = os.getenv("SEED_DEMO_DATA", "true").lower() == "true"
COMPANY_NAME = os.getenv("COMPANY_NAME", "Asten Labs")
REMEMBER_TOKEN_DAYS = int(os.getenv("JWT_REMEMBER_DAYS", "30"))
LOCK_TIMEOUT_SECONDS = int(os.getenv("EXCEL_LOCK_TIMEOUT", "30"))
