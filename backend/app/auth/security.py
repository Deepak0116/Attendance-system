from datetime import datetime, timedelta, timezone

import bcrypt
import jwt

from app import config


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8")[:72], bcrypt.gensalt()).decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(password.encode("utf-8")[:72], hashed.encode("utf-8"))
    except ValueError:
        return False


def create_access_token(user_id: str, role: str, remember: bool = False) -> str:
    """``remember`` = "keep me signed in on this computer" (used by the start-up popup)."""
    lifetime = timedelta(days=config.REMEMBER_TOKEN_DAYS) if remember else timedelta(minutes=config.TOKEN_EXPIRE_MINUTES)
    expire = datetime.now(timezone.utc) + lifetime
    return jwt.encode({"sub": user_id, "role": role, "exp": expire}, config.SECRET_KEY, algorithm=config.ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, config.SECRET_KEY, algorithms=[config.ALGORITHM])
