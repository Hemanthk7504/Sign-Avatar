"""
Social Media & Two-User Interaction API endpoints:
- GET  /api/social/feed
- POST /api/social/posts
- POST /api/social/posts/{post_id}/react
- POST /api/social/posts/{post_id}/comments
- GET  /api/social/directory
- POST /api/social/follow/{target_user_id}
- GET  /api/social/messages/{peer_id}
- POST /api/social/messages
- POST /api/social/messages/{message_id}/react
- GET  /api/social/stats
"""
from __future__ import annotations

import logging
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from app.api.auth_routes import get_current_user, get_optional_user
from app.services import social_service

logger = logging.getLogger("sign_avatar.api.social")
router = APIRouter(prefix="/api/social", tags=["social"])


class CreatePostRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=600)
    variant: str = Field(default="ASL")
    style: str = Field(default="expressive")
    avatar_model: str = Field(default="/models/michelle.glb")
    tags: List[str] = Field(default_factory=list)


class ReactRequest(BaseModel):
    reaction_type: str = Field(default="ily", description="like | ily | clap | fire")


class CreateCommentRequest(BaseModel):
    content: str = Field(..., min_length=1, max_length=400)
    variant: str = Field(default="ASL")


class SendDirectMessageRequest(BaseModel):
    recipient_id: str = Field(..., min_length=1)
    content: str = Field(..., min_length=1, max_length=500)
    variant: Optional[str] = None
    style: Optional[str] = None
    avatar_model: Optional[str] = None
    sender_override_id: Optional[str] = Field(
        default=None,
        description="Optional sender ID for Dual-User Turn-Taking Studio mode when authenticated",
    )


@router.get("/stats")
def platform_stats(current_user: Optional[dict] = Depends(get_optional_user)):
    uid = current_user["id"] if current_user else None
    return social_service.get_platform_stats(current_user_id=uid)


@router.get("/feed")
def get_feed(
    variant: Optional[str] = Query(default=None),
    current_user: Optional[dict] = Depends(get_optional_user),
):
    uid = current_user["id"] if current_user else None
    posts = social_service.list_feed_posts(current_user_id=uid, variant_filter=variant)
    return {"posts": posts}


@router.post("/posts")
def create_post(
    req: CreatePostRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        post = social_service.create_feed_post(
            author_id=current_user["id"],
            content=req.content,
            variant=req.variant,
            style=req.style,
            avatar_model=req.avatar_model,
            tags=req.tags,
        )
        return {"post": post}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/posts/{post_id}/react")
def react_to_post(
    post_id: str,
    req: ReactRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        post = social_service.toggle_post_reaction(
            post_id=post_id,
            user_id=current_user["id"],
            reaction_type=req.reaction_type,
        )
        return {"post": post}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/posts/{post_id}/comments")
def comment_on_post(
    post_id: str,
    req: CreateCommentRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        post = social_service.add_post_comment(
            post_id=post_id,
            author_id=current_user["id"],
            content=req.content,
            variant=req.variant,
        )
        return {"post": post}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/directory")
def community_directory(current_user: dict = Depends(get_current_user)):
    users = social_service.get_community_directory(current_user_id=current_user["id"])
    return {"users": users}


@router.post("/follow/{target_user_id}")
def toggle_follow(
    target_user_id: str,
    current_user: dict = Depends(get_current_user),
):
    try:
        res = social_service.toggle_follow_user(
            follower_id=current_user["id"],
            following_id=target_user_id,
        )
        return res
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.get("/messages/{peer_id}")
def get_direct_messages(
    peer_id: str,
    user_a_id: Optional[str] = Query(default=None),
    current_user: dict = Depends(get_current_user),
):
    active_user_id = user_a_id or current_user["id"]
    messages = social_service.list_direct_messages(
        user_a_id=active_user_id,
        user_b_id=peer_id,
    )
    return {"messages": messages}


@router.post("/messages")
def send_message(
    req: SendDirectMessageRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        sender_id = req.sender_override_id or current_user["id"]
        msg = social_service.send_direct_message(
            sender_id=sender_id,
            recipient_id=req.recipient_id,
            content=req.content,
            variant=req.variant,
            style=req.style,
            avatar_model=req.avatar_model,
        )
        return {"message": msg}
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.post("/messages/{message_id}/react")
def react_to_message(
    message_id: str,
    req: ReactRequest,
    current_user: dict = Depends(get_current_user),
):
    try:
        res = social_service.react_to_direct_message(
            message_id=message_id,
            user_id=current_user["id"],
            reaction=req.reaction_type,
        )
        return res
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
