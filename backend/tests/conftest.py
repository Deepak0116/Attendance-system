import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
_tmp = tempfile.mkdtemp()
os.environ["ATTENDANCE_DATA_FILE"] = str(Path(_tmp) / "test_attendance.xlsx")
os.environ["ADMIN_PASSWORD"] = "Admin@123"

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.utils import timeutil
from tests import demo_data


@pytest.fixture(scope="session")
def client():
    with TestClient(app) as c:  # startup creates the workbook + admin only
        demo_data.load()        # the fake company exists only inside the tests
        yield c
    timeutil.set_now(None)
