"""
Generative 3D Sign Language Avatar Synthesis — FastAPI backend entrypoint.

Run with:
    uvicorn main:app --reload --host 0.0.0.0 --port 8000
"""
import logging

from fastapi import FastAPI, Request
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from fastapi.middleware.cors import CORSMiddleware

from app.api.auth_routes import router as auth_router
from app.api.evaluation_routes import router as eval_router
from app.api.mms_routes import router as mms_router
from app.api.routes import router as api_router
from app.api.social_routes import router as social_router
from app.api.websocket import router as ws_router
from app.config import settings
from app.services.social_service import init_social_db

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")

app = FastAPI(title=settings.APP_NAME)

init_social_db()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

app.include_router(auth_router)
app.include_router(social_router)
app.include_router(api_router)
app.include_router(eval_router)
app.include_router(mms_router)
app.include_router(ws_router)


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse(
        request,
        "index.html",
        {
            "app_name": settings.APP_NAME,
            "active_page": "landing",
            "variants": settings.SUPPORTED_VARIANTS,
            "default_variant": settings.DEFAULT_VARIANT,
        },
    )


@app.get("/home")
async def home_page(request: Request):
    return templates.TemplateResponse(
        request,
        "home.html",
        {
            "app_name": settings.APP_NAME,
            "active_page": "home",
            "variants": settings.SUPPORTED_VARIANTS,
            "default_variant": settings.DEFAULT_VARIANT,
        },
    )


@app.get("/community")
async def community_page(request: Request):
    return templates.TemplateResponse(
        request,
        "community.html",
        {
            "app_name": settings.APP_NAME,
            "active_page": "community",
            "variants": settings.SUPPORTED_VARIANTS,
            "default_variant": settings.DEFAULT_VARIANT,
        },
    )


@app.get("/login")
async def login_page(request: Request):
    return templates.TemplateResponse(
        request,
        "login.html",
        {
            "app_name": settings.APP_NAME,
            "active_page": "login",
        },
    )


@app.get("/register")
async def register_page(request: Request):
    return templates.TemplateResponse(
        request,
        "login.html",
        {
            "app_name": settings.APP_NAME,
            "active_page": "register",
            "initial_mode": "register",
        },
    )


@app.get("/dashboard")
async def dashboard(request: Request):
    return templates.TemplateResponse(
        request,
        "dashboard.html",
        {
            "app_name": settings.APP_NAME,
            "active_page": "dashboard",
            "variants": settings.SUPPORTED_VARIANTS,
            "default_variant": settings.DEFAULT_VARIANT,
        },
    )


@app.get("/how-it-works")
async def how_it_works(request: Request):
    return templates.TemplateResponse(
        request,
        "how_it_works.html",
        {
            "app_name": settings.APP_NAME,
            "active_page": "how_it_works",
        },
    )


@app.get("/about")
async def about(request: Request):
    return templates.TemplateResponse(
        request,
        "about.html",
        {
            "app_name": settings.APP_NAME,
            "active_page": "about",
        },
    )


@app.get("/evaluation")
async def evaluation_page(request: Request):
    return templates.TemplateResponse(
        request,
        "evaluation.html",
        {
            "app_name": settings.APP_NAME,
            "active_page": "evaluation",
        },
    )


