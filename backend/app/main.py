import asyncio
import logging
import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles

from app import config, seed
from app.routers import attendance, auth, employees, misc, requests, wfh_location
from app.services import wfh_service
from app.utils.excel_store import StoreError

log = logging.getLogger("attendance")


async def _background_sweeper() -> None:
    """Server-side housekeeping: WFH due/missed notifications and location retention. No location is read here."""
    while True:
        try:
            await asyncio.to_thread(wfh_service.sweep)
        except Exception:  # never let housekeeping kill the loop
            log.exception("Background sweep failed")
        await asyncio.sleep(60)


@asynccontextmanager
async def lifespan(app: FastAPI):
    seed.run()
    task = asyncio.create_task(_background_sweeper())
    yield
    task.cancel()


app = FastAPI(title="Employee Attendance, Leave & WFH Management System", version="1.0.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=config.CORS_ORIGINS, allow_credentials=True,
                   allow_methods=["*"], allow_headers=["*"], expose_headers=["Content-Disposition"])


@app.exception_handler(StoreError)
async def store_error_handler(_: Request, exc: StoreError):
    log.error("Excel store error: %s", exc)
    return JSONResponse(status_code=503, content={"detail": str(exc)})


@app.exception_handler(RequestValidationError)
async def validation_handler(_: Request, exc: RequestValidationError):
    msgs = []
    for err in exc.errors():
        field = ".".join(str(p) for p in err["loc"] if p not in ("body", "query"))
        msgs.append(f"{field}: {err['msg']}" if field else err["msg"])
    return JSONResponse(status_code=422, content={"detail": "; ".join(msgs) or "Invalid request"})


@app.exception_handler(Exception)
async def unhandled_handler(_: Request, exc: Exception):
    log.exception("Unhandled error", exc_info=exc)
    return JSONResponse(status_code=500, content={"detail": "An unexpected server error occurred"})


for r in (auth.router, employees.router, attendance.router, requests.leave_router, requests.wfh_router,
          wfh_location.router, requests.requests_router, misc.notifications_router, misc.dashboard_router,
          misc.reports_router, misc.settings_router, misc.comp_off_router, misc.report_key_router):
    app.include_router(r, prefix="/api")


@app.get("/api/health", tags=["System"])
def health():
    return {"status": "ok", "company": config.COMPANY_NAME}


# Hosted mode: when the built website (frontend/dist) is present, serve it from this same server.
DIST = Path(os.getenv("FRONTEND_DIST", config.BASE_DIR.parent / "frontend" / "dist"))
if (DIST / "index.html").is_file():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def website(path: str):
        if path.startswith("api/"):
            return JSONResponse(status_code=404, content={"detail": "Not found"})
        target = (DIST / path).resolve()
        if path and target.is_file() and DIST.resolve() in target.parents:
            return FileResponse(target)
        return FileResponse(DIST / "index.html")
