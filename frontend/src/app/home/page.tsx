"use client";

import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { AuthGuard } from "@/components/auth/AuthGuard";
import { useAuth } from "@/context/AuthContext";
import { AvatarStage } from "@/components/avatar/AvatarStage";
import { MotionWebSocketClient, GlossToken } from "@/lib/websocket";
import {
  FeedPost,
  DirectMessage,
  PlatformStats,
  DirectoryUser,
  fetchFeedPosts,
  fetchDirectMessages,
  fetchPlatformStats,
  fetchCommunityDirectory,
  createFeedPost,
  togglePostReaction,
  sendDirectMessage,
} from "@/lib/api";

function HomeWorkspaceContent() {
  const { user, quickDemoLogin } = useAuth();

  // Data state
  const [stats, setStats] = useState<PlatformStats | null>(null);
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [directory, setDirectory] = useState<DirectoryUser[]>([]);
  const [peerId, setPeerId] = useState<string>("usr_alex_02");
  const [messages, setMessages] = useState<DirectMessage[]>([]);

  // Quick composer state
  const [quickText, setQuickText] = useState("Hello everyone! How are you feeling today?");
  const [quickVariant, setQuickVariant] = useState(user?.preferred_variant || "ASL");
  const [quickStyle, setQuickStyle] = useState(user?.preferred_style || "expressive");
  const [quickReply, setQuickReply] = useState("");
  const [statusBanner, setStatusBanner] = useState("");

  // 3D Avatar stage state on Home Page
  const [currentFrame, setCurrentFrame] = useState<number[][] | null>(null);
  const [avatarModel, setAvatarModel] = useState(user?.avatar_model || "/models/michelle.glb");
  const [activePhrase, setActivePhrase] = useState("Welcome to your SignAvatar Home Hub");
  const [activeGlosses, setActiveGlosses] = useState<GlossToken[]>([]);
  const [showDebug, setShowDebug] = useState(false);
  const [fps, setFps] = useState(25);
  const [isSigning, setIsSigning] = useState(false);

  const wsRef = useRef<MotionWebSocketClient | null>(null);
  const frameQueueRef = useRef<number[][][]>([]);
  const playStartRef = useRef<number>(0);
  const isPlayingRef = useRef<boolean>(false);
  const animIdRef = useRef<number | null>(null);

  const loadDashboardData = async () => {
    try {
      const [st, feed, dir] = await Promise.all([
        fetchPlatformStats(),
        fetchFeedPosts("ALL"),
        fetchCommunityDirectory(),
      ]);
      setStats(st);
      setPosts(feed);
      setDirectory(dir);

      const defaultPeer =
        user?.id === "usr_maya_01"
          ? "usr_alex_02"
          : user?.id === "usr_alex_02"
          ? "usr_maya_01"
          : dir.find((u) => u.id !== user?.id)?.id || "usr_alex_02";
      setPeerId(defaultPeer);

      const dms = await fetchDirectMessages(defaultPeer);
      setMessages(dms);
    } catch (err) {
      console.error("Failed loading home dashboard data:", err);
    }
  };

  useEffect(() => {
    loadDashboardData();
  }, [user?.id]);

  // Connect WebSocket for 3D motion preview on Home page
  useEffect(() => {
    const ws = new MotionWebSocketClient({
      onSessionReady: () => {
        ws.sendText("welcome");
      },
      onGloss: (tokens) => {
        setActiveGlosses(tokens);
      },
      onSequenceStart: () => {
        frameQueueRef.current = [];
        playStartRef.current = performance.now();
        isPlayingRef.current = true;
        setIsSigning(true);
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
          setIsSigning(false);
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

  const playPhraseOn3DStage = (
    text: string,
    variant = "ASL",
    style = "expressive",
    model = "/models/michelle.glb"
  ) => {
    setActivePhrase(text);
    setAvatarModel(model);
    wsRef.current?.sendConfig(variant, style, undefined, "diffusion");
    wsRef.current?.sendText(text);
  };

  const handlePublishQuickPost = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickText.trim()) return;
    try {
      const created = await createFeedPost({
        content: quickText.trim(),
        variant: quickVariant,
        style: quickStyle,
        avatar_model: avatarModel,
        tags: [quickVariant, "HomeHub"],
      });
      setPosts((prev) => [created, ...prev]);
      playPhraseOn3DStage(created.content, created.variant, created.style, created.avatar_model);
      setStatusBanner("Signed post published to Community Feed & streaming on 3D Stage!");
      setTimeout(() => setStatusBanner(""), 4000);
      fetchPlatformStats().then(setStats).catch(() => {});
    } catch (err: any) {
      setStatusBanner(err?.message || "Failed to publish post");
    }
  };

  const handleQuickReact = async (postId: string, rtype: string) => {
    try {
      const updated = await togglePostReaction(postId, rtype);
      setPosts((prev) => prev.map((p) => (p.id === postId ? updated : p)));
      fetchPlatformStats().then(setStats).catch(() => {});
    } catch {}
  };

  const handleQuickSendDm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickReply.trim()) return;
    try {
      const msg = await sendDirectMessage({
        recipient_id: peerId,
        content: quickReply.trim(),
        variant: quickVariant,
        style: quickStyle,
        avatar_model: user?.avatar_model || "/models/michelle.glb",
      });
      setMessages((prev) => [...prev, msg]);
      setQuickReply("");
      playPhraseOn3DStage(msg.content, msg.variant, msg.style, msg.avatar_model);
      fetchPlatformStats().then(setStats).catch(() => {});
    } catch {}
  };

  const peerUser = directory.find((u) => u.id === peerId);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 w-full flex flex-col gap-8">
      {/* ── PERSONALIZED HOME COMMAND HEADER ──────────────────────────────── */}
      <div className="rounded-2xl bg-gradient-to-r from-[#0F172A] via-[#1E3A5F] to-[#1D4ED8] text-[#FFFFFF] p-6 sm:p-8 shadow-lg">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6">
          <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-xs font-bold bg-[#FFFFFF]/15 text-[#FFFFFF] border border-[#FFFFFF]/20">
                ✓ Authenticated Session
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#38BDF8]/20 text-[#E0F2FE]">
                Primary Language: {user?.preferred_variant || "ASL"}
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-[#FFFFFF]/10 text-[#E2E8F0]">
                Role: {user?.role?.replace(/_/g, " ")}
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight mt-1">
              Welcome home, {user?.full_name} 👋
            </h1>
            <p className="text-sm text-[#E2E8F0] max-w-2xl">
              {user?.bio ||
                "Your centralized 3D Sign Language workspace. Synthesize continuous motion, publish signed posts to the community feed, or converse in real-time 2-user sign dialogues."}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3 shrink-0">
            <Link
              href="/community"
              className="px-4 py-2.5 rounded-xl bg-[#FFFFFF] text-[#0F172A] text-xs font-bold hover:bg-[#F1F5F9] transition-all shadow-sm"
            >
              Open 2-User Social Hub →
            </Link>
            <Link
              href="/studio"
              className="px-4 py-2.5 rounded-xl bg-[#1D4ED8] text-[#FFFFFF] border border-[#60A5FA]/40 text-xs font-bold hover:bg-[#1E40AF] transition-all shadow-sm"
            >
              Full 3D Signing Studio
            </Link>
          </div>
        </div>

        {/* Live Telemetry & Social KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-[#FFFFFF]/15">
          <div className="bg-[#FFFFFF]/10 rounded-xl p-3.5 backdrop-blur-xs">
            <div className="text-xl sm:text-2xl font-bold font-mono">
              {stats?.total_posts ?? posts.length}
            </div>
            <div className="text-xs text-[#E2E8F0] font-medium">Community Signed Posts</div>
          </div>
          <div className="bg-[#FFFFFF]/10 rounded-xl p-3.5 backdrop-blur-xs">
            <div className="text-xl sm:text-2xl font-bold font-mono">
              {stats?.total_dms ?? messages.length}
            </div>
            <div className="text-xs text-[#E2E8F0] font-medium">2-User Sign Messages</div>
          </div>
          <div className="bg-[#FFFFFF]/10 rounded-xl p-3.5 backdrop-blur-xs">
            <div className="text-xl sm:text-2xl font-bold font-mono">
              {stats?.total_reactions ?? 5}
            </div>
            <div className="text-xs text-[#E2E8F0] font-medium">Community 🤟 Reactions</div>
          </div>
          <div className="bg-[#FFFFFF]/10 rounded-xl p-3.5 backdrop-blur-xs">
            <div className="text-xl sm:text-2xl font-bold font-mono">
              {stats?.total_users ?? directory.length}
            </div>
            <div className="text-xs text-[#E2E8F0] font-medium">Verified Signer Profiles</div>
          </div>
        </div>
      </div>

      {statusBanner && (
        <div className="p-4 rounded-xl bg-[#F0FDF4] border border-[#BBF7D0] text-xs font-semibold text-[#15803D] flex items-center justify-between">
          <span>✓ {statusBanner}</span>
          <button onClick={() => setStatusBanner("")} className="text-xs underline">
            Dismiss
          </button>
        </div>
      )}

      {/* ── MAIN WORKSPACE GRID: 3D STAGE + QUICK COMPOSER & SOCIAL HUB ──── */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        {/* Left 5 Cols: Interactive 3D Sign Stage + Quick Sign Composer */}
        <div className="lg:col-span-5 flex flex-col gap-6">
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm overflow-hidden">
            <div className="px-4 py-3 border-b border-[#E2E8F0] flex items-center justify-between bg-[#F8FAFC]">
              <div className="flex items-center gap-2">
                <span
                  className={`w-2.5 h-2.5 rounded-full ${
                    isSigning ? "bg-[#1D4ED8] animate-ping" : "bg-[#15803D]"
                  }`}
                />
                <span className="text-xs font-bold text-[#0F172A]">
                  {isSigning ? "Signing Live on 3D Rig…" : "Home 3D Interpreter Stage"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <select
                  value={avatarModel}
                  onChange={(e) => setAvatarModel(e.target.value)}
                  className="px-2 py-1 text-xs rounded-lg border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] font-medium"
                >
                  <option value="/models/michelle.glb">Michelle (Human)</option>
                  <option value="/models/avatar.glb">Alex (RPM)</option>
                </select>
                <span className="text-xs font-mono text-[#475569]">{fps} fps</span>
              </div>
            </div>

            <div className="relative aspect-[4/3] w-full bg-[#F8FAFC]">
              <AvatarStage
                currentFrame={currentFrame}
                showDebug={showDebug}
                modelUrl={avatarModel}
                onFpsUpdate={setFps}
                className="w-full h-full"
              />
            </div>

            <div className="p-4 border-t border-[#E2E8F0] bg-[#FFFFFF]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-xs font-semibold text-[#475569]">Active Utterance:</span>
                <label className="flex items-center gap-1.5 text-xs text-[#475569] cursor-pointer">
                  <input
                    type="checkbox"
                    checked={showDebug}
                    onChange={(e) => setShowDebug(e.target.checked)}
                    className="rounded border-[#CBD5E1]"
                  />
                  <span>66-pt Skeleton</span>
                </label>
              </div>
              <p className="text-xs font-bold text-[#0F172A] mb-2">&ldquo;{activePhrase}&rdquo;</p>
              {activeGlosses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {activeGlosses.map((g, i) => (
                    <span
                      key={`${g.gloss}-${i}`}
                      className="px-2 py-0.5 rounded bg-[#EFF6FF] border border-[#BFDBFE] font-mono text-xs font-bold text-[#1D4ED8]"
                    >
                      {g.gloss}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Quick Sign & Publish Composer */}
          <form
            onSubmit={handlePublishQuickPost}
            className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm p-5 flex flex-col gap-3.5"
          >
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[#0F172A]">
                Quick Sign &amp; Broadcast to Community
              </h2>
              <span className="text-xs font-semibold text-[#1D4ED8]">Auto-Gloss</span>
            </div>
            <textarea
              rows={2}
              value={quickText}
              onChange={(e) => setQuickText(e.target.value)}
              placeholder="Write a phrase to sign in 3D and share with the community…"
              className="w-full px-3 py-2 text-xs rounded-xl border border-[#CBD5E1] text-[#0F172A] focus:border-[#1D4ED8] outline-none resize-none"
            />
            <div className="grid grid-cols-2 gap-2.5">
              <select
                value={quickVariant}
                onChange={(e) => setQuickVariant(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-[#FFFFFF]"
              >
                <option value="ASL">ASL (American)</option>
                <option value="DSGS">DSGS (Swiss German)</option>
                <option value="LSF-CH">LSF-CH (Swiss French)</option>
                <option value="LIS-CH">LIS-CH (Swiss Italian)</option>
              </select>
              <select
                value={quickStyle}
                onChange={(e) => setQuickStyle(e.target.value)}
                className="px-2.5 py-1.5 text-xs rounded-lg border border-[#CBD5E1] bg-[#FFFFFF]"
              >
                <option value="expressive">Expressive Style</option>
                <option value="neutral">Neutral Style</option>
                <option value="compact">Compact Style</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() =>
                  playPhraseOn3DStage(quickText, quickVariant, quickStyle, avatarModel)
                }
                className="flex-1 py-2.5 px-3 rounded-xl border border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#F1F5F9] text-xs font-semibold text-[#0F172A] transition-colors"
              >
                ▶ Preview on 3D Stage
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 px-3 rounded-xl bg-[#1D4ED8] hover:bg-[#1E40AF] text-xs font-semibold text-[#FFFFFF] transition-colors shadow-sm"
              >
                🤟 Publish Signed Post
              </button>
            </div>
          </form>
        </div>

        {/* Right 7 Cols: The 2 Social Media Interactions Overview */}
        <div className="lg:col-span-7 flex flex-col gap-6">
          {/* INTERACTION 1: COMMUNITY SIGN FEED PREVIEW */}
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-[#EFF6FF] text-[#1D4ED8]">
                  Social Interaction #1
                </span>
                <h2 className="text-base font-bold text-[#0F172A] mt-1">
                  Community 3D Sign Feed
                </h2>
              </div>
              <Link
                href="/community?tab=feed"
                className="text-xs font-bold text-[#1D4ED8] hover:text-[#1E40AF]"
              >
                View Full Feed ({posts.length}) →
              </Link>
            </div>

            <div className="flex flex-col gap-3.5">
              {posts.slice(0, 3).map((post) => (
                <div
                  key={post.id}
                  className="p-4 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]/60 hover:border-[#CBD5E1] transition-all"
                >
                  <div className="flex items-center justify-between gap-2 mb-2">
                    <div className="flex items-center gap-2">
                      <span className="w-7 h-7 rounded-lg bg-[#1E3A5F] text-[#FFFFFF] font-bold text-xs flex items-center justify-center">
                        {post.author.full_name
                          .split(" ")
                          .map((w) => w[0])
                          .join("")
                          .slice(0, 2)}
                      </span>
                      <div>
                        <span className="text-xs font-bold text-[#0F172A]">
                          {post.author.full_name}
                        </span>
                        <span className="text-xs text-[#475569] ml-1.5">
                          @{post.author.username} &middot; {post.variant}
                        </span>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() =>
                        playPhraseOn3DStage(
                          post.content,
                          post.variant,
                          post.style,
                          post.avatar_model
                        )
                      }
                      className="px-3 py-1 rounded-lg bg-[#1D4ED8] text-[#FFFFFF] text-xs font-semibold hover:bg-[#1E40AF] transition-colors shadow-xs"
                    >
                      ▶ Sign in 3D
                    </button>
                  </div>

                  <p className="text-xs text-[#0F172A] leading-relaxed mb-2.5">{post.content}</p>

                  {/* Gloss chips */}
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {post.gloss_sequence.slice(0, 8).map((g, idx) => (
                      <span
                        key={`${g.gloss}-${idx}`}
                        className="px-2 py-0.5 rounded bg-[#FFFFFF] border border-[#E2E8F0] font-mono text-xs font-semibold text-[#1E3A5F]"
                      >
                        {g.gloss}
                      </span>
                    ))}
                  </div>

                  {/* Reactions & Comment Count */}
                  <div className="flex items-center justify-between pt-2 border-t border-[#E2E8F0]/80 text-xs">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => handleQuickReact(post.id, "ily")}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                          post.user_reaction === "ily"
                            ? "bg-[#EFF6FF] border-[#1D4ED8] text-[#1D4ED8]"
                            : "bg-[#FFFFFF] border-[#E2E8F0] text-[#475569] hover:text-[#0F172A]"
                        }`}
                      >
                        🤟 ILY ({post.reaction_counts.ily})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickReact(post.id, "clap")}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                          post.user_reaction === "clap"
                            ? "bg-[#EFF6FF] border-[#1D4ED8] text-[#1D4ED8]"
                            : "bg-[#FFFFFF] border-[#E2E8F0] text-[#475569] hover:text-[#0F172A]"
                        }`}
                      >
                        👏 ({post.reaction_counts.clap})
                      </button>
                      <button
                        type="button"
                        onClick={() => handleQuickReact(post.id, "fire")}
                        className={`px-2.5 py-1 rounded-lg border text-xs font-semibold transition-colors ${
                          post.user_reaction === "fire"
                            ? "bg-[#EFF6FF] border-[#1D4ED8] text-[#1D4ED8]"
                            : "bg-[#FFFFFF] border-[#E2E8F0] text-[#475569] hover:text-[#0F172A]"
                        }`}
                      >
                        🔥 ({post.reaction_counts.fire})
                      </button>
                    </div>
                    <Link
                      href="/community?tab=feed"
                      className="text-xs font-semibold text-[#475569] hover:text-[#1D4ED8]"
                    >
                      💬 {post.comment_count} Signed Replies
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* INTERACTION 2: 2-USER DIRECT SIGN MESSENGER PREVIEW */}
          <div className="bg-[#FFFFFF] rounded-2xl border border-[#E2E8F0] shadow-sm p-6">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
              <div>
                <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-bold bg-[#F0FDF4] text-[#15803D] border border-[#BBF7D0]">
                  Social Interaction #2 &middot; 2-User P2P
                </span>
                <h2 className="text-base font-bold text-[#0F172A] mt-1">
                  Two-User Interactive Sign Messenger ({user?.full_name} ↔{" "}
                  {peerUser?.full_name || "Dr. Alex Rivera"})
                </h2>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() =>
                    quickDemoLogin(user?.username === "maya_lin" ? "alex" : "maya")
                  }
                  className="px-2.5 py-1 rounded-lg border border-[#CBD5E1] bg-[#F8FAFC] hover:bg-[#EFF6FF] text-xs font-semibold text-[#1E3A5F]"
                >
                  ⇄ Switch Active User
                </button>
                <Link
                  href="/community?tab=messages"
                  className="text-xs font-bold text-[#1D4ED8] hover:text-[#1E40AF]"
                >
                  Open Dual Studio →
                </Link>
              </div>
            </div>

            <div className="flex flex-col gap-2.5 max-h-64 overflow-y-auto p-3 rounded-xl bg-[#F8FAFC] border border-[#E2E8F0] mb-3">
              {messages.map((m) => {
                const isMe = m.sender_id === user?.id;
                return (
                  <div
                    key={m.id}
                    className={`flex flex-col p-3 rounded-xl max-w-[88%] ${
                      isMe
                        ? "self-end bg-[#EFF6FF] border border-[#BFDBFE]"
                        : "self-start bg-[#FFFFFF] border border-[#E2E8F0]"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-3 mb-1">
                      <span className="text-xs font-bold text-[#0F172A]">
                        {m.sender.full_name} ({m.variant})
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          playPhraseOn3DStage(
                            m.content,
                            m.variant,
                            m.style,
                            m.avatar_model
                          )
                        }
                        className="px-2 py-0.5 rounded bg-[#1D4ED8] text-[#FFFFFF] text-xs font-semibold hover:bg-[#1E40AF]"
                      >
                        ▶ Sign
                      </button>
                    </div>
                    <p className="text-xs text-[#0F172A] mb-1.5">{m.content}</p>
                    <div className="flex flex-wrap gap-1">
                      {m.gloss_sequence.map((g, i) => (
                        <span
                          key={`${g.gloss}-${i}`}
                          className="px-1.5 py-0.2 rounded bg-[#FFFFFF]/90 border border-[#CBD5E1] font-mono text-[11px] font-semibold text-[#1E3A5F]"
                        >
                          {g.gloss}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>

            <form onSubmit={handleQuickSendDm} className="flex gap-2">
              <input
                type="text"
                value={quickReply}
                onChange={(e) => setQuickReply(e.target.value)}
                placeholder={`Send a signed reply as ${user?.full_name} to ${
                  peerUser?.full_name || "Dr. Alex Rivera"
                }…`}
                className="flex-1 px-3.5 py-2 text-xs rounded-xl border border-[#CBD5E1] bg-[#FFFFFF] text-[#0F172A] focus:border-[#1D4ED8] outline-none"
              />
              <button
                type="submit"
                className="px-4 py-2 rounded-xl bg-[#1D4ED8] text-[#FFFFFF] text-xs font-semibold hover:bg-[#1E40AF] transition-colors shrink-0"
              >
                Send &amp; Sign 🤟
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function SeparateHomePage() {
  return (
    <AuthGuard featureName="your personal SignAvatar Home Dashboard">
      <HomeWorkspaceContent />
    </AuthGuard>
  );
}
