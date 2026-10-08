"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { MotionWebSocketClient, GlossToken } from "@/lib/websocket";
import {
  FeedPost,
  DirectMessage,
  DirectoryUser,
  fetchFeedPosts,
  createFeedPost,
  togglePostReaction,
  addPostComment,
  fetchCommunityDirectory,
  toggleFollowUser,
  fetchDirectMessages,
  sendDirectMessage,
  reactToDirectMessage,
} from "@/lib/api";

function CommunityHubContent() {
  const searchParams = useSearchParams();
  const initialTab = searchParams.get("tab") === "messages" ? "messages" : "feed";
  const { user, quickDemoLogin } = useAuth();

  const [activeTab, setActiveTab] = useState<"feed" | "messages">(initialTab);

  // Feed State (Interaction #1)
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [variantFilter, setVariantFilter] = useState("ALL");
  const [newPostContent, setNewPostContent] = useState("");
  const [newPostVariant, setNewPostVariant] = useState(user?.preferred_variant || "ASL");
  const [newPostStyle, setNewPostStyle] = useState(user?.preferred_style || "expressive");
  const [newPostAvatar, setNewPostAvatar] = useState(user?.avatar_model || "/models/michelle.glb");
  const [newPostTags, setNewPostTags] = useState("ASL, DeafCommunity, 3DMotion");
  const [commentInputs, setCommentInputs] = useState<Record<string, string>>({});
  const [expandedComments, setExpandedComments] = useState<Record<string, boolean>>({
    post_seed_01: true,
    post_seed_02: true,
  });

  // Two-User Messenger & Directory State (Interaction #2)
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [selectedPeerId, setSelectedPeerId] = useState<string>("usr_alex_02");
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [dmInput, setDmInput] = useState("");
  const [dmTurnSenderId, setDmTurnSenderId] = useState<string>(user?.id || "usr_maya_01");
  const [isPlayingDialogue, setIsPlayingDialogue] = useState(false);

  // Shared 3D Interpreter Stage State
  const [currentFrame, setCurrentFrame] = useState<number[][] | null>(null);
  const [stageAvatar, setStageAvatar] = useState<string>("/models/michelle.glb");
  const [stageSpeakerName, setStageSpeakerName] = useState<string>("Maya Lin");
  const [stagePhrase, setStagePhrase] = useState<string>(
    "Select any community post, comment, or 2-user message to synthesize in 3D"
  );
  const [stageGlosses, setStageGlosses] = useState<GlossToken[]>([]);
  const [showDebug, setShowDebug] = useState<boolean>(false);
  const [fps, setFps] = useState<number>(25);
  const [statusNotice, setStatusNotice] = useState<string>("");

  const wsRef = useRef<MotionWebSocketClient | null>(null);
  const frameQueueRef = useRef<number[][][]>([]);
  const playStartRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const animIdRef = useRef<number | null>(null);

  // Sync default peer when user changes
  useEffect(() => {
    if (!user) return;
    setDmTurnSenderId(user.id);
    if (user.id === selectedPeerId) {
      setSelectedPeerId(user.id === "usr_maya_01" ? "usr_alex_02" : "usr_maya_01");
    }
  }, [user]);

  const loadSocialData = async () => {
    try {
      const [feedData, dirData] = await Promise.all([
        fetchFeedPosts(variantFilter),
        fetchCommunityDirectory(),
      ]);
      setPosts(feedData);
      setDirectory(dirData);
    } catch (err) {
      console.error("Error loading social hub:", err);
    }
  };

  useEffect(() => {
    loadSocialData();
  }, [variantFilter, user?.id]);

  useEffect(() => {
    if (!selectedPeerId || !user) return;
    const userA =
      user.id === selectedPeerId
        ? user.id === "usr_maya_01"
          ? "usr_alex_02"
          : "usr_maya_01"
        : user.id;
    fetchDirectMessages(selectedPeerId, userA)
      .then(setMessages)
      .catch((err) => console.error("Failed loading DMs:", err));
  }, [selectedPeerId, user]);

  // Connect WebSocket for 3D motion streaming
  useEffect(() => {
    const ws = new MotionWebSocketClient({
      onGloss: (tokens) => {
        setStageGlosses(tokens);
      },
      onSequenceStart: () => {
        frameQueueRef.current = [];
        playStartRef.current = performance.now();
        isPlayingRef.current = true;
      },
      onFrames: (frames) => {
        frameQueueRef.current.push(...frames);
      },
    });
    ws.connect();
    wsRef.current = ws;

    const tick = (now: number) => {
      if (isPlayingRef.current && frameQueueRef.current.length > 0) {
        const elapsed = (now - playStartRef.current) / 1000;
        const idx = Math.floor(elapsed * 25);
        if (idx < frameQueueRef.current.length) {
          setCurrentFrame(frameQueueRef.current[idx]);
        } else {
          isPlayingRef.current = false;
          setCurrentFrame(null);
        }
      }
      animIdRef.current = requestAnimationFrame(tick);
    };
    animIdRef.current = requestAnimationFrame(tick);

    return () => {
      if (animIdRef.current) cancelAnimationFrame(animIdRef.current);
      ws.disconnect();
    };
  }, []);

  const trigger3DSynthesis = (
    text: string,
    speaker: string,
    variant = "ASL",
    style = "expressive",
    avatar = "/models/michelle.glb"
  ) => {
    setStageSpeakerName(speaker);
    setStagePhrase(text);
    setStageAvatar(avatar);
    wsRef.current?.sendConfig(variant, style, undefined, "diffusion");
    wsRef.current?.sendText(text);
  };

  // Interaction #1 Handlers: Posts, Reactions, Signed Comments
  const handleCreatePost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newPostContent.trim()) return;
    try {
      const tags = newPostTags
        .split(",")
        .map((t) => t.trim().replace(/^#/, ""))
        .filter(Boolean);
      const created = await createFeedPost({
        content: newPostContent.trim(),
        variant: newPostVariant,
        style: newPostStyle,
        avatar_model: newPostAvatar,
        tags,
      });
      setPosts((prev) => [created, ...prev]);
      setNewPostContent("");
      trigger3DSynthesis(
        created.content,
        created.author.full_name,
        created.variant,
        created.style,
        created.avatar_model
      );
      setStatusNotice("Signed post published & streaming in 3D!");
      setTimeout(() => setStatusNotice(""), 3500);
    } catch (err: any) {
      setStatusNotice(err?.message || "Failed to create post");
    }
  };

  const handleReactPost = async (postId: string, rtype: string) => {
    try {
      const updated = await togglePostReaction(postId, rtype);
      setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
    } catch {}
  };

  const handleAddComment = async (postId: string, variant: string) => {
    const text = (commentInputs[postId] || "").trim();
    if (!text) return;
    try {
      const updated = await addPostComment(postId, text, variant);
      setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
      setCommentInputs((prev) => ({ ...prev, [postId]: "" }));
      setExpandedComments((prev) => ({ ...prev, [postId]: true }));
      trigger3DSynthesis(
        text,
        user?.full_name || "Signer",
        variant,
        "expressive",
        user?.avatar_model || "/models/michelle.glb"
      );
    } catch {}
  };

  // Interaction #2 Handlers: Follow & 2-User Direct Sign Conversation
  const handleToggleFollow = async (targetUserId: string) => {
    try {
      const res = await toggleFollowUser(targetUserId);
      setDirectory((prev) =>
        prev.map((u) =>
          u.id === targetUserId
            ? { ...u, is_following: res.is_following, followers_count: res.followers_count }
            : u
        )
      );
    } catch {}
  };

  const peerUser =
    directory.find((u) => u.id === selectedPeerId) ||
    directory.find((u) => u.id !== user?.id);

  const userAProfile = directory.find((u) => u.id === user?.id) || user;

  const handleSendDirectMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!dmInput.trim() || !peerUser || !user) return;

    const actualSenderId = dmTurnSenderId || user.id;
    const actualRecipientId =
      actualSenderId === user.id ? peerUser.id : user.id;

    const senderObj =
      directory.find((u) => u.id === actualSenderId) || user;

    try {
      const msg = await sendDirectMessage({
        recipient_id: actualRecipientId,
        content: dmInput.trim(),
        variant: senderObj.preferred_variant || "ASL",
        style: senderObj.preferred_style || "expressive",
        avatar_model: senderObj.avatar_model || "/models/michelle.glb",
        sender_override_id: actualSenderId,
      });
      setMessages((prev) => [...prev, msg]);
      setDmInput("");
      trigger3DSynthesis(
        msg.content,
        msg.sender.full_name,
        msg.variant,
        msg.style,
        msg.avatar_model
      );
    } catch (err: any) {
      setStatusNotice(err?.message || "Failed to send signed message");
    }
  };

  const handleReactDm = async (messageId: string, rtype: string) => {
    try {
      const res = await reactToDirectMessage(messageId, rtype);
      setMessages((prev) =>
        prev.map((m) => (m.id === messageId ? { ...m, reaction: res.reaction } : m))
      );
    } catch {}
  };

  const handlePlayFullDialogue = () => {
    if (messages.length === 0 || isPlayingDialogue) return;
    setIsPlayingDialogue(true);
    let idx = 0;
    const playNext = () => {
      if (idx >= messages.length) {
        setIsPlayingDialogue(false);
        return;
      }
      const m = messages[idx];
      trigger3DSynthesis(
        m.content,
        m.sender.full_name,
        m.variant,
        m.style,
        m.avatar_model
      );
      idx += 1;
      setTimeout(playNext, 3800);
    };
    playNext();
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex flex-col gap-6">
      {/* ── TOP HEADER & INTERACTION SWITCHER ────────────────────────────── */}
      <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm p-6 flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE]">
              SignAvatar Social Network
            </span>
            <span className="text-xs text-[#475569]">
              Signed as <strong className="text-[#0F172A]">{user?.full_name}</strong> (@
              {user?.username})
            </span>
          </div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Community 3D Sign Feed &amp; Two-User Sign Studio
          </h1>
        </div>

        {/* Switch between the 2 Social Media User Interactions */}
        <div className="flex items-center gap-2 bg-[#F1F5F9] p-1.5 rounded-xl border border-[#E2E8F0]">
          <button
            type="button"
            onClick={() => setActiveTab("feed")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === "feed"
                ? "bg-[#1D4ED8] text-[#FFFFFF] shadow-xs"
                : "text-[#475569] hover:text-[#0F172A]"
            }`}
          >
            1. Community Sign Feed ({posts.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("messages")}
            className={`px-4 py-2 rounded-lg text-xs font-bold transition-all ${
              activeTab === "messages"
                ? "bg-[#1D4ED8] text-[#FFFFFF] shadow-xs"
                : "text-[#475569] hover:text-[#0F172A]"
            }`}
          >
            2. Two-User Sign Messenger ({messages.length})
          </button>
        </div>
      </div>

      {statusNotice && (
        <div className="p-3.5 rounded-xl bg-[#EFF6FF] border border-[#BFDBFE] text-xs font-semibold text-[#1D4ED8] flex items-center justify-between">
          <span>🤟 {statusNotice}</span>
          <button onClick={() => setStatusNotice("")} className="underline">
            Close
          </button>
        </div>
      )}

      {/* ── MAIN 12-COLUMN LAYOUT: STICKY 3D STAGE + INTERACTION STREAM ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 5 Columns: Live 3D Avatar Interpreter Stage + Community Directory */}
        <div className="lg:col-span-5 flex flex-col gap-6 lg:sticky lg:top-20">
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            <div className="px-4 py-3 bg-[#0F172A] text-[#FFFFFF] flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-[#22C55E] animate-pulse" />
                <span className="text-xs font-bold">
                  3D Sign Stage &middot; {stageSpeakerName}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={stageAvatar}
                  onChange={(e) => setStageAvatar(e.target.value)}
                  className="px-2 py-0.5 text-xs rounded bg-[#1E293B] text-[#FFFFFF] border border-[#334155]"
                >
                  <option value="/models/michelle.glb">Michelle Rig</option>
                  <option value="/models/avatar.glb">Alex Rig</option>
                </select>
                <span className="text-xs font-mono text-[#94A3B8]">{fps} fps</span>
              </div>
            </div>

            <div className="relative aspect-[4/3] w-full bg-[#F8FAFC]">
              <AvatarStage
                currentFrame={currentFrame}
                showDebug={showDebug}
                modelUrl={stageAvatar}
                onFpsUpdate={setFps}
                className="w-full h-full"
              />
            </div>

            <div className="p-4 border-t border-[#E2E8F0] bg-[#FFFFFF]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-bold text-[#1D4ED8]">
                  Active Signed Utterance
                </span>
                <label className="flex items-center gap-1.5 text-xs text-[#475569] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDebug}
                    onChange={(e) => setShowDebug(e.target.checked)}
                    className="rounded border-[#CBD5E1]"
                  />
                  <span>Biomechanical landmarks</span>
                </label>
              </div>
              <p className="text-xs font-semibold text-[#0F172A] mb-2">
                &ldquo;{stagePhrase}&rdquo;
              </p>
              {stageGlosses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {stageGlosses.map((g, idx) => (
                    <span
                      key={`${g.gloss}-${idx}`}
                      className="px-2 py-0.5 rounded bg-[#F1F5F9] border border-[#E2E8F0] font-mono text-xs font-bold text-[#1E3A5F]"
                    >
                      {g.gloss}
                      {g.non_manual && g.non_manual.length > 0 && (
                        <span className="ml-1 text-[10px] font-sans font-normal text-[#B45309]">
                          [{g.non_manual.join(",")}]
                        </span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Community Signers Directory & Follow Network */}
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm p-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-sm font-bold text-[#0F172A]">
                Verified Signer Directory
              </h2>
              <span className="text-xs text-[#475569]">{directory.length} members</span>
            </div>
            <div className="flex flex-col gap-2.5">
              {directory.map((member) => {
                const isSelf = member.id === user?.id;
                const isSelectedPeer = member.id === selectedPeerId;
                return (
                  <div
                    key={member.id}
                    className={`p-3 rounded-xl border transition-all flex items-center justify-between gap-2 ${
                      isSelectedPeer && activeTab === "messages"
                        ? "border-[#1D4ED8] bg-[#EFF6FF]/60"
                        : "border-[#E2E8F0] bg-[#F8FAFC]/50"
                    }`}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-lg bg-[#1E3A5F] text-[#FFFFFF] font-bold text-xs flex items-center justify-center shrink-0">
                        {member.full_name
                          .split(" ")
                          .map((w) => w[0])
                          .join("")
                          .slice(0, 2)}
                      </span>
                      <div className="min-w-0">
                        <div className="text-xs font-bold text-[#0F172A] truncate flex items-center gap-1">
                          <span>{member.full_name}</span>
                          {member.verified && <span className="text-[#1D4ED8]">✓</span>}
                          {isSelf && (
                            <span className="px-1.5 py-0.2 rounded bg-[#E2E8F0] text-[10px] font-semibold text-[#0F172A]">
                              You
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-[#475569] truncate">
                          @{member.username} &middot; {member.preferred_variant} &middot;{" "}
                          {member.followers_count} followers
                        </div>
                      </div>
                    </div>

                    {!isSelf && (
                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          type="button"
                          onClick={() => handleToggleFollow(member.id)}
                          className={`px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors ${
                            member.is_following
                              ? "bg-[#FFFFFF] border-[#CBD5E1] text-[#0F172A] hover:bg-[#F1F5F9]"
                              : "bg-[#1D4ED8] border-[#1D4ED8] text-[#FFFFFF] hover:bg-[#1E40AF]"
                          }`}
                        >
                          {member.is_following ? "Following" : "+ Follow"}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setSelectedPeerId(member.id);
                            setActiveTab("messages");
                          }}
                          className="px-2.5 py-1 rounded-lg text-xs font-semibold bg-[#EFF6FF] text-[#1D4ED8] border border-[#BFDBFE] hover:bg-[#DBEAFE]"
                        >
                          Chat
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Right 7 Columns: Active Social Interaction View */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {activeTab === "feed" ? (
            <>
              {/* ── INTERACTION 1: COMMUNITY SIGN FEED COMPOSER & STREAM ────── */}
              <form
                onSubmit={handleCreatePost}
                className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm p-6 flex flex-col gap-4"
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="w-8 h-8 rounded-lg bg-[#1D4ED8] text-[#FFFFFF] font-bold text-xs flex items-center justify-center">
                      {user?.full_name
                        .split(" ")
                        .map((w) => w[0])
                        .join("")
                        .slice(0, 2)}
                    </span>
                    <div>
                      <h2 className="text-sm font-bold text-[#0F172A]">
                        Create a 3D Signed Community Post
                      </h2>
                      <span className="text-xs text-[#475569]">
                        Automatically extracts linguistic gloss tokens &amp; grammatical facial markers
                      </span>
                    </div>
                  </div>
                </div>

                <textarea
                  rows={3}
                  value={newPostContent}
                  onChange={(e) => setNewPostContent(e.target.value)}
                  placeholder="Share a signed thought, question, or phrase with the community (e.g. Where is the accessible entrance?)…"
                  className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-[#CBD5E1] text-[#0F172A] focus:border-[#1D4ED8] outline-none resize-none"
                />

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2.5">
                  <select
                    value={newPostVariant}
                    onChange={(e) => setNewPostVariant(e.target.value)}
                    className="px-2.5 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] font-medium"
                  >
                    <option value="ASL">ASL (American)</option>
                    <option value="DSGS">DSGS (Swiss German)</option>
                    <option value="LSF-CH">LSF-CH (Swiss French)</option>
                    <option value="LIS-CH">LIS-CH (Swiss Italian)</option>
                  </select>

                  <select
                    value={newPostStyle}
                    onChange={(e) => setNewPostStyle(e.target.value)}
                    className="px-2.5 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] font-medium"
                  >
                    <option value="expressive">Expressive</option>
                    <option value="neutral">Neutral</option>
                    <option value="compact">Compact</option>
                  </select>

                  <select
                    value={newPostAvatar}
                    onChange={(e) => setNewPostAvatar(e.target.value)}
                    className="px-2.5 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] font-medium"
                  >
                    <option value="/models/michelle.glb">Michelle Avatar</option>
                    <option value="/models/avatar.glb">Alex Avatar</option>
                  </select>

                  <input
                    type="text"
                    value={newPostTags}
                    onChange={(e) => setNewPostTags(e.target.value)}
                    placeholder="Tags: ASL, Medical"
                    className="px-2.5 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF]"
                  />
                </div>

                <div className="flex justify-end gap-2.5">
                  <button
                    type="button"
                    onClick={() => {
                      if (newPostContent.trim()) {
                        trigger3DSynthesis(
                          newPostContent.trim(),
                          user?.full_name || "You",
                          newPostVariant,
                          newPostStyle,
                          newPostAvatar
                        );
                      }
                    }}
                    className="px-4 py-2 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-xs font-semibold text-[#0F172A]"
                  >
                    ▶ Preview Motion
                  </button>
                  <button
                    type="submit"
                    className="px-5 py-2 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-xs font-bold text-[#FFFFFF] shadow-sm"
                  >
                    Publish Signed Post 🤟
                  </button>
                </div>
              </form>

              {/* Variant Filter Bar */}
              <div className="flex items-center justify-between bg-[#FFFFFF] px-4 py-3 rounded-xl border border-[#E2E8F0]">
                <span className="text-xs font-bold text-[#0F172A]">Filter by Sign Language:</span>
                <div className="flex flex-wrap gap-1.5">
                  {["ALL", "ASL", "DSGS", "LSF-CH", "LIS-CH"].map((v) => (
                    <button
                      key={v}
                      type="button"
                      onClick={() => setVariantFilter(v)}
                      className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors ${
                        variantFilter === v
                          ? "bg-[#1D4ED8] text-[#FFFFFF]"
                          : "bg-[#F1F5F9] text-[#475569] hover:text-[#0F172A]"
                      }`}
                    >
                      {v}
                    </button>
                  ))}
                </div>
              </div>

              {/* Feed Posts List */}
              <div className="flex flex-col gap-5">
                {posts.map((post) => (
                  <article
                    key={post.id}
                    className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm p-6 flex flex-col gap-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <span className="w-10 h-10 rounded-xl bg-[#1E3A5F] text-[#FFFFFF] font-bold text-xs flex items-center justify-center">
                          {post.author.full_name
                            .split(" ")
                            .map((w) => w[0])
                            .join("")
                            .slice(0, 2)}
                        </span>
                        <div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-bold text-[#0F172A]">
                              {post.author.full_name}
                            </span>
                            {post.author.verified && (
                              <span
                                className="px-1.5 py-0.2 rounded bg-[#EFF6FF] text-[#1D4ED8] text-[10px] font-bold"
                                title="Verified Signer"
                              >
                                ✓ Verified
                              </span>
                            )}
                            <span className="px-2 py-0.2 rounded-full bg-[#F1F5F9] text-xs font-semibold text-[#475569]">
                              {post.variant} &middot; {post.style}
                            </span>
                          </div>
                          <div className="text-xs text-[#475569]">
                            @{post.author.username} &middot;{" "}
                            {post.author.role.replace(/_/g, " ")}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          trigger3DSynthesis(
                            post.content,
                            post.author.full_name,
                            post.variant,
                            post.style,
                            post.avatar_model
                          )
                        }
                        className="px-3.5 py-2 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] text-xs font-bold shadow-xs transition-all shrink-0"
                      >
                        ▶ Sign This Post in 3D
                      </button>
                    </div>

                    <p className="text-sm text-[#0F172A] leading-relaxed">{post.content}</p>

                    {/* Extracted Gloss Sequence */}
                    <div className="p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0]">
                      <div className="text-[11px] font-semibold text-[#475569] mb-1.5">
                        Syntactic Gloss Sequence &amp; Non-Manual Markers:
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {post.gloss_sequence.map((g, i) => (
                          <span
                            key={`${g.gloss}-${i}`}
                            className="px-2.5 py-1 rounded-lg bg-[#FFFFFF] border border-[#CBD5E1] font-mono text-xs font-bold text-[#1E3A5F]"
                          >
                            {g.gloss}
                            {g.non_manual && g.non_manual.length > 0 && (
                              <span className="ml-1 text-[10px] font-sans font-normal text-[#B45309]">
                                [{g.non_manual.join(", ")}]
                              </span>
                            )}
                          </span>
                        ))}
                      </div>
                    </div>

                    {/* Tags */}
                    {post.tags && post.tags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {post.tags.map((tag) => (
                          <span
                            key={tag}
                            className="text-xs font-semibold text-[#1D4ED8] bg-[#EFF6FF] px-2 py-0.5 rounded-md"
                          >
                            #{tag}
                          </span>
                        ))}
                      </div>
                    )}

                    {/* Reactions & Comments Toggle Bar */}
                    <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-[#E2E8F0]">
                      <div className="flex flex-wrap items-center gap-2">
                        {[
                          { key: "ily", label: "🤟 ILY", count: post.reaction_counts.ily },
                          { key: "clap", label: "👏 Applause", count: post.reaction_counts.clap },
                          { key: "fire", label: "🔥 Expressive", count: post.reaction_counts.fire },
                          { key: "like", label: "👍 Helpful", count: post.reaction_counts.like },
                        ].map((r) => {
                          const active = post.user_reaction === r.key;
                          return (
                            <button
                              key={r.key}
                              type="button"
                              onClick={() => handleReactPost(post.id, r.key)}
                              className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition-all ${
                                active
                                  ? "bg-[#EFF6FF] border-[#1D4ED8] text-[#1D4ED8] shadow-2xs"
                                  : "bg-[#FFFFFF] border-[#E2E8F0] text-[#475569] hover:text-[#0F172A] hover:bg-[#F8FAFC]"
                              }`}
                            >
                              {r.label} ({r.count})
                            </button>
                          );
                        })}
                      </div>

                      <button
                        type="button"
                        onClick={() =>
                          setExpandedComments((prev) => ({
                            ...prev,
                            [post.id]: !prev[post.id],
                          }))
                        }
                        className="text-xs font-bold text-[#1E3A5F] hover:text-[#1D4ED8]"
                      >
                        💬 {post.comment_count} Signed Replies
                      </button>
                    </div>

                    {/* Threaded Signed Comments */}
                    {expandedComments[post.id] && (
                      <div className="pt-3 border-t border-[#F1F5F9] flex flex-col gap-3">
                        {post.comments.map((cmt) => (
                          <div
                            key={cmt.id}
                            className="p-3.5 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] flex flex-col gap-2"
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-[#0F172A]">
                                  {cmt.author.full_name}
                                </span>
                                <span className="text-xs text-[#475569]">
                                  @{cmt.author.username}
                                </span>
                              </div>
                              <button
                                type="button"
                                onClick={() =>
                                  trigger3DSynthesis(
                                    cmt.content,
                                    cmt.author.full_name,
                                    cmt.variant,
                                    "expressive",
                                    cmt.author.avatar_model
                                  )
                                }
                                className="px-2.5 py-1 rounded-lg bg-[#FFFFFF] border border-[#CBD5E1] hover:border-[#1D4ED8] text-xs font-semibold text-[#1D4ED8]"
                              >
                                ▶ Sign Reply
                              </button>
                            </div>
                            <p className="text-xs text-[#0F172A]">{cmt.content}</p>
                            <div className="flex flex-wrap gap-1">
                              {cmt.gloss_sequence.map((g, idx) => (
                                <span
                                  key={`${g.gloss}-${idx}`}
                                  className="px-1.5 py-0.5 rounded bg-[#FFFFFF] border border-[#E2E8F0] font-mono text-[11px] font-semibold text-[#1E3A5F]"
                                >
                                  {g.gloss}
                                </span>
                              ))}
                            </div>
                          </div>
                        ))}

                        <div className="flex gap-2">
                          <input
                            type="text"
                            value={commentInputs[post.id] || ""}
                            onChange={(e) =>
                              setCommentInputs((prev) => ({
                                ...prev,
                                [post.id]: e.target.value,
                              }))
                            }
                            placeholder={`Reply with a signed comment as ${user?.full_name}…`}
                            className="flex-1 px-3 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] outline-none focus:border-[#1D4ED8]"
                          />
                          <button
                            type="button"
                            onClick={() => handleAddComment(post.id, post.variant)}
                            className="px-4 py-2 rounded-xl bg-[#1E3A5F] hover:bg-[#0F172A] text-[#FFFFFF] text-xs font-semibold shrink-0"
                          >
                            Post Signed Reply
                          </button>
                        </div>
                      </div>
                    )}
                  </article>
                ))}
              </div>
            </>
          ) : (
            /* ── INTERACTION 2: TWO-USER DIRECT SIGN MESSENGER & TURN-TAKING STUDIO ── */
            <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden flex flex-col">
              {/* Messenger Header */}
              <div className="p-5 bg-gradient-to-r from-[#0F172A] to-[#1E3A5F] text-[#FFFFFF] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div>
                  <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-[#22C55E]/20 text-[#86EFAC]">
                    Live 2-User Sign Language Dialogue
                  </span>
                  <h2 className="text-base font-bold mt-1">
                    {user?.full_name} ↔ {peerUser?.full_name || "Dr. Alex Rivera"}
                  </h2>
                  <p className="text-xs text-[#CBD5E1]">
                    Every message is translated to sign glosses and synthesized on the sender&apos;s 3D humanoid rig.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={handlePlayFullDialogue}
                  disabled={isPlayingDialogue || messages.length === 0}
                  className="px-4 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-[#2563EB] text-[#FFFFFF] text-xs font-bold shadow-sm transition-all shrink-0 disabled:opacity-60"
                >
                  {isPlayingDialogue
                    ? "Playing 2-User Dialogue…"
                    : "▶ Play Full 2-User Dialogue in 3D"}
                </button>
              </div>

              {/* Dual-User Turn Switcher Bar (allows testing both User 1 & User 2 turns seamlessly) */}
              <div className="px-5 py-3 bg-[#F8FAFC] border-b border-[#E2E8F0] flex flex-wrap items-center justify-between gap-2">
                <span className="text-xs font-bold text-[#0F172A]">
                  Active Turn / Sender Perspective:
                </span>
                <div className="flex items-center gap-2">
                  {userAProfile && (
                    <button
                      type="button"
                      onClick={() => setDmTurnSenderId(userAProfile.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                        dmTurnSenderId === userAProfile.id
                          ? "bg-[#1D4ED8] border-[#1D4ED8] text-[#FFFFFF]"
                          : "bg-[#FFFFFF] border-[#CBD5E1] text-[#475569]"
                      }`}
                    >
                      User 1: {userAProfile.full_name} (Michelle)
                    </button>
                  )}
                  {peerUser && (
                    <button
                      type="button"
                      onClick={() => setDmTurnSenderId(peerUser.id)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold border transition-all ${
                        dmTurnSenderId === peerUser.id
                          ? "bg-[#0F766E] border-[#0F766E] text-[#FFFFFF]"
                          : "bg-[#FFFFFF] border-[#CBD5E1] text-[#475569]"
                      }`}
                    >
                      User 2: {peerUser.full_name} (Alex)
                    </button>
                  )}
                </div>
              </div>

              {/* Conversation Thread */}
              <div className="p-5 flex flex-col gap-4 max-h-[500px] overflow-y-auto bg-[#F8FAFC]/50">
                {messages.map((m) => {
                  const isUser1 = m.sender_id === user?.id;
                  return (
                    <div
                      key={m.id}
                      className={`flex flex-col p-4 rounded-2xl max-w-[88%] shadow-2xs ${
                        isUser1
                          ? "self-start bg-[#FFFFFF] border border-[#CBD5E1]"
                          : "self-end bg-[#EFF6FF] border border-[#BFDBFE]"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-4 mb-1.5">
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-6 h-6 rounded-md text-[#FFFFFF] font-bold text-xs flex items-center justify-center ${
                              isUser1 ? "bg-[#1D4ED8]" : "bg-[#0F766E]"
                            }`}
                          >
                            {m.sender.full_name[0]}
                          </span>
                          <span className="text-xs font-bold text-[#0F172A]">
                            {m.sender.full_name}
                          </span>
                          <span className="text-xs text-[#475569]">
                            ({m.variant} &middot; {m.style})
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={() =>
                            trigger3DSynthesis(
                              m.content,
                              m.sender.full_name,
                              m.variant,
                              m.style,
                              m.avatar_model
                            )
                          }
                          className="px-2.5 py-1 rounded-lg bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] text-xs font-bold"
                        >
                          ▶ Sign on 3D Stage
                        </button>
                      </div>

                      <p className="text-sm text-[#0F172A] mb-2">{m.content}</p>

                      {/* Gloss sequence */}
                      <div className="flex flex-wrap gap-1 mb-2">
                        {m.gloss_sequence.map((g, i) => (
                          <span
                            key={`${g.gloss}-${i}`}
                            className="px-2 py-0.5 rounded bg-[#F8FAFC] border border-[#CBD5E1] font-mono text-xs font-bold text-[#1E3A5F]"
                          >
                            {g.gloss}
                          </span>
                        ))}
                      </div>

                      {/* Message Reactions */}
                      <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]/60">
                        <div className="flex items-center gap-1.5">
                          {[
                            { k: "ily", icon: "🤟" },
                            { k: "clap", icon: "👏" },
                            { k: "fire", icon: "🔥" },
                          ].map((r) => (
                            <button
                              key={r.k}
                              type="button"
                              onClick={() => handleReactDm(m.id, r.k)}
                              className={`px-2 py-0.5 rounded text-xs border ${
                                m.reaction === r.k
                                  ? "bg-[#1D4ED8] text-[#FFFFFF] border-[#1D4ED8]"
                                  : "bg-[#FFFFFF] text-[#475569] border-[#E2E8F0]"
                              }`}
                            >
                              {r.icon}
                            </button>
                          ))}
                        </div>
                        <span className="text-[11px] text-[#475569]">
                          Avatar:{" "}
                          {m.avatar_model.includes("michelle") ? "Michelle" : "Alex"}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Send Signed Message Composer */}
              <form
                onSubmit={handleSendDirectMessage}
                className="p-4 bg-[#FFFFFF] border-t border-[#E2E8F0] flex flex-col sm:flex-row gap-2.5"
              >
                <input
                  type="text"
                  value={dmInput}
                  onChange={(e) => setDmInput(e.target.value)}
                  placeholder={`Type a message to sign as ${
                    dmTurnSenderId === user?.id
                      ? user?.full_name
                      : peerUser?.full_name || "User 2"
                  }…`}
                  className="flex-1 px-3.5 py-2.5 text-sm rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] outline-none"
                />
                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-[#FFFFFF] text-xs font-bold shadow-sm shrink-0"
                >
                  Send &amp; Sign in 3D 🤟
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default function CommunityPage() {
  return (
    <AuthGuard featureName="the 2-User Social Hub & Community Sign Feed">
      <Suspense fallback={<div className="p-12 text-center text-sm">Loading Social Hub…</div>}>
        <CommunityHubContent />
      </Suspense>
    </AuthGuard>
  );
}
