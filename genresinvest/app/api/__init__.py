from fastapi import APIRouter

from . import admin, auth, contractors, dictionaries, orders, reports

api_router = APIRouter(prefix="/api/v1")
for module in (auth, contractors, dictionaries, orders, reports, admin):
    api_router.include_router(module.router)
