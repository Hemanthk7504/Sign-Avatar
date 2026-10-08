"""
Strict Authentication API endpoints:
- POST /api/auth/register
- POST /api/auth/login
- POST /api/auth/logout
- GET  /api/auth/me
- PUT  /api/auth/profile
- GET  /api/auth/users
- POST /api/auth/validate-password
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Cookie, Depends, Header, HTTPException, Response
from pydantic import BaseModel, Field

from app.services import auth_service

logger = logging.getLogger("sign_avatar.api.auth")
router = APIRouter(prefix="/api/auth", tags=["authentication"])


class RegisterRequest(BaseModel):
    email: str = Field(..., min_length=3, max_length=120)
    username: str = Field(..., min_length=3, max_length=28)
    full_name: str = Field(..., min_length=2, max_length=80)
    password: str = Field(..., min_length=1, max_length=128)
    role: str = Field(default="deaf_signer")
    preferred_variant: str = Field(default="ASL")
    preferred_style: str = Field(default="expressive")
    avatar_model: str = Field(default="/models/michelle.glb")
    bio: str = Field(default="")


class LoginRequest(BaseModel):
    email: str = Field(..., description="Email address or username")
    password: str = Field(..., min_length=1)


class ProfileUpdateRequest(BaseModel):
    full_name: Optional[str] = None
    bio: Optional[str] = None
    preferred_variant: Optional[str] = None
    preferred_style: Optional[str] = None
    avatar_model: Optional[str] = None


class PasswordCheckRequest(BaseModel):
    password: str


def extract_token(
    authorization: Optional[str] = Header(default=None),
    sa_token: Optional[str] = Cookie(default=None),
) -> Optional[str]:
    if authorization and authorization.strip():
        return authorization.strip()
    if sa_token and sa_token.strip():
        return sa_token.strip()
    return None


def get_current_user(
    token: Optional[str] = Depends(extract_token),
) -> dict:
    if not token:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please sign in with a valid account.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    user = auth_service.verify_session_token(token)
    if not user:
        raise HTTPException(
            status_code=401,
            detail="Invalid or expired session token. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return user


def get_optional_user(
    token: Optional[str] = Depends(extract_token),
) -> Optional[dict]:
    if not token:
        return None
    return auth_service.verify_session_token(token)


@router.post("/register")
def register(req: RegisterRequest, response: Response):
    try:
        result = auth_service.register_user(
            email=req.email,
            username=req.username,
            full_name=req.full_name,
            password=req.password,
            role=req.role,
            preferred_variant=req.preferred_variant,
            preferred_style=req.preferred_style,
            avatar_model=req.avatar_model,
            bio=req.bio,
        )
        response.set_cookie(
            key="sa_token",
            value=result["token"],
            httponly=True,
            samesite="lax",
            max_age=86400,
        )
        return result
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/login")
def login(req: LoginRequest, response: Response):
    try:
        result = auth_service.authenticate_user(
            identifier=req.email,
            password=req.password,
        )
        response.set_cookie(
            key="sa_token",
            value=result["token"],
            httponly=True,
            samesite="lax",
            max_age=86400,
        )
        return result
    except ValueError as exc:
        status_code = 429 if "locked" in str(exc).lower() else 401
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc


@router.post("/logout")
def logout(
    response: Response,
    token: Optional[str] = Depends(extract_token),
):
    if token:
        auth_service.revoke_session_token(token)
    response.delete_cookie("sa_token")
    return {"status": "logged_out"}


@router.get("/me")
def me(current_user: dict = Depends(get_current_user)):
    return {"user": current_user}


@router.put("/profile")
def update_profile(
    req: ProfileUpdateRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        updated = auth_service.update_user_profile(
            user_id=current_user["id"],
            full_name=req.full_name,
            bio=req.bio,
            preferred_variant=req.preferred_variant,
            preferred_style=req.preferred_style,
            avatar_model=req.avatar_model,
        )
        return {"user": updated}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/users")
def list_users(current_user: dict = Depends(get_current_user)):
    return {"users": auth_service.list_all_users(current_user_id=current_user["id"])}


@router.post("/validate-password")
def check_password_strength(req: PasswordCheckRequest):
    valid, violations = auth_service.validate_password_strength(req.password)
    return {"valid": valid, "violations": violations}
