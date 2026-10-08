export interface AppConfig {
  fps: number;
  variants: string[];
  default_variant: string;
  styles: string[];
  backend: string;
}

export interface VocabularyItem {
  word: string;
  variant: string;
}

export interface Participant {
  participant_id: string;
  role: string;
  created_at: string;
}

export interface EvaluationResponse {
  participant_id: string;
  role: string;
  stimulus_text: string;
  backend: string;
  variant: string;
  free_recall: string;
  ratings: {
    comprehension: number;
    naturalness: number;
    grammaticality: number;
  };
  gloss_sequence?: string[];
  notes?: string;
}

export interface UserProfile {
  id: string;
  username: string;
  email: string;
  full_name: string;
  role: string;
  preferred_variant: string;
  preferred_style: string;
  avatar_model: string;
  bio: string;
  verified: boolean;
  created_at: string;
}

export interface DirectoryUser extends UserProfile {
  followers_count: number;
  following_count: number;
  post_count: number;
  is_following: boolean;
}

export interface GlossItem {
  word: string;
  gloss: string;
  non_manual?: string[];
  fingerspelled?: boolean;
}

export interface PostComment {
  id: string;
  post_id: string;
  content: string;
  variant: string;
  gloss_sequence: GlossItem[];
  created_at: string;
  author: {
    id: string;
    username: string;
    full_name: string;
    role: string;
    avatar_model: string;
    verified: boolean;
  };
}

export interface FeedPost {
  id: string;
  content: string;
  variant: string;
  style: string;
  avatar_model: string;
  gloss_sequence: GlossItem[];
  tags: string[];
  created_at: string;
  author: {
    id: string;
    username: string;
    full_name: string;
    role: string;
    preferred_variant: string;
    avatar_model: string;
    verified: boolean;
  };
  reaction_counts: {
    like: number;
    ily: number;
    clap: number;
    fire: number;
  };
  total_reactions: number;
  user_reaction: string | null;
  comments: PostComment[];
  comment_count: number;
}

export interface DirectMessage {
  id: string;
  sender_id: string;
  recipient_id: string;
  content: string;
  variant: string;
  style: string;
  avatar_model: string;
  gloss_sequence: GlossItem[];
  reaction: string | null;
  created_at: string;
  sender: {
    id: string;
    username: string;
    full_name: string;
    role: string;
    verified: boolean;
  };
  recipient: {
    id: string;
    username: string;
    full_name: string;
  };
}

export interface PlatformStats {
  total_users: number;
  total_posts: number;
  total_reactions: number;
  total_comments: number;
  total_dms: number;
  user_stats: {
    posts: number;
    dms: number;
    followers: number;
    following: number;
  };
}

const API_BASE =
  typeof window !== "undefined"
    ? window.location.port === "3000"
      ? `http://${window.location.hostname}:8000`
      : ""
    : "http://127.0.0.1:8000";
const TOKEN_STORAGE_KEY = "sa_auth_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }
}

function authHeaders(extra: Record<string, string> = {}): Record<string, string> {
  const headers: Record<string, string> = { ...extra };
  const token = getStoredToken();
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return headers;
}

async function handleResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let detail = res.statusText;
    try {
      const body = await res.json();
      detail = body.detail || body.message || detail;
    } catch {}
    throw new Error(detail);
  }
  return res.json();
}

// ── Authentication Endpoints ────────────────────────────────────────────────

export async function loginUser(email: string, password: string): Promise<{ token: string; user: UserProfile }> {
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await handleResponse<{ token: string; user: UserProfile }>(res);
  setStoredToken(data.token);
  return data;
}

export async function registerUser(payload: {
  email: string;
  username: string;
  full_name: string;
  password: string;
  role: string;
  preferred_variant: string;
  preferred_style?: string;
  avatar_model?: string;
  bio?: string;
}): Promise<{ token: string; user: UserProfile }> {
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ token: string; user: UserProfile }>(res);
  setStoredToken(data.token);
  return data;
}

export async function logoutUser(): Promise<void> {
  try {
    await fetch(`${API_BASE}/api/auth/logout`, {
      method: "POST",
      headers: authHeaders(),
    });
  } finally {
    setStoredToken(null);
  }
}

export async function fetchCurrentUser(): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: authHeaders(),
  });
  const data = await handleResponse<{ user: UserProfile }>(res);
  return data.user;
}

export async function updateProfile(payload: {
  full_name?: string;
  bio?: string;
  preferred_variant?: string;
  preferred_style?: string;
  avatar_model?: string;
}): Promise<UserProfile> {
  const res = await fetch(`${API_BASE}/api/auth/profile`, {
    method: "PUT",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ user: UserProfile }>(res);
  return data.user;
}

// ── Social & Two-User Interaction Endpoints ─────────────────────────────────

export async function fetchPlatformStats(): Promise<PlatformStats> {
  const res = await fetch(`${API_BASE}/api/social/stats`, {
    headers: authHeaders(),
  });
  return handleResponse<PlatformStats>(res);
}

export async function fetchFeedPosts(variant = "ALL"): Promise<FeedPost[]> {
  const q = variant && variant !== "ALL" ? `?variant=${encodeURIComponent(variant)}` : "";
  const res = await fetch(`${API_BASE}/api/social/feed${q}`, {
    headers: authHeaders(),
  });
  const data = await handleResponse<{ posts: FeedPost[] }>(res);
  return data.posts;
}

export async function createFeedPost(payload: {
  content: string;
  variant: string;
  style: string;
  avatar_model: string;
  tags: string[];
}): Promise<FeedPost> {
  const res = await fetch(`${API_BASE}/api/social/posts`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ post: FeedPost }>(res);
  return data.post;
}

export async function togglePostReaction(postId: string, reactionType: string): Promise<FeedPost> {
  const res = await fetch(`${API_BASE}/api/social/posts/${encodeURIComponent(postId)}/react`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ reaction_type: reactionType }),
  });
  const data = await handleResponse<{ post: FeedPost }>(res);
  return data.post;
}

export async function addPostComment(postId: string, content: string, variant = "ASL"): Promise<FeedPost> {
  const res = await fetch(`${API_BASE}/api/social/posts/${encodeURIComponent(postId)}/comments`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ content, variant }),
  });
  const data = await handleResponse<{ post: FeedPost }>(res);
  return data.post;
}

export async function fetchCommunityDirectory(): Promise<DirectoryUser[]> {
  const res = await fetch(`${API_BASE}/api/social/directory`, {
    headers: authHeaders(),
  });
  const data = await handleResponse<{ users: DirectoryUser[] }>(res);
  return data.users;
}

export async function toggleFollowUser(targetUserId: string): Promise<{
  follower_id: string;
  following_id: string;
  is_following: boolean;
  followers_count: number;
}> {
  const res = await fetch(`${API_BASE}/api/social/follow/${encodeURIComponent(targetUserId)}`, {
    method: "POST",
    headers: authHeaders(),
  });
  return handleResponse(res);
}

export async function fetchDirectMessages(peerId: string, userAId?: string): Promise<DirectMessage[]> {
  const q = userAId ? `?user_a_id=${encodeURIComponent(userAId)}` : "";
  const res = await fetch(`${API_BASE}/api/social/messages/${encodeURIComponent(peerId)}${q}`, {
    headers: authHeaders(),
  });
  const data = await handleResponse<{ messages: DirectMessage[] }>(res);
  return data.messages;
}

export async function sendDirectMessage(payload: {
  recipient_id: string;
  content: string;
  variant?: string;
  style?: string;
  avatar_model?: string;
  sender_override_id?: string;
}): Promise<DirectMessage> {
  const res = await fetch(`${API_BASE}/api/social/messages`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(payload),
  });
  const data = await handleResponse<{ message: DirectMessage }>(res);
  return data.message;
}

export async function reactToDirectMessage(messageId: string, reactionType: string): Promise<{ id: string; reaction: string | null }> {
  const res = await fetch(`${API_BASE}/api/social/messages/${encodeURIComponent(messageId)}/react`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ reaction_type: reactionType }),
  });
  return handleResponse(res);
}

// ── Generation & Evaluation Endpoints ───────────────────────────────────────

export async function fetchConfig(): Promise<AppConfig> {
  const res = await fetch(`${API_BASE}/api/config`);
  return handleResponse<AppConfig>(res);
}

export async function fetchVocabulary(variant = "ASL"): Promise<VocabularyItem[]> {
  const res = await fetch(`${API_BASE}/api/vocabulary?variant=${encodeURIComponent(variant)}`);
  return handleResponse<VocabularyItem[]>(res);
}

export async function generateText(text: string, variant = "ASL", style = "neutral") {
  const res = await fetch(`${API_BASE}/api/generate/text`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ text, variant, style }),
  });
  return handleResponse(res);
}

export async function generateSpeech(audioBlob: Blob, variant = "ASL", style = "neutral") {
  const formData = new FormData();
  formData.append("audio", audioBlob, "recording.wav");
  formData.append("variant", variant);
  formData.append("style", style);

  const res = await fetch(`${API_BASE}/api/generate/speech`, {
    method: "POST",
    headers: authHeaders(),
    body: formData,
  });
  return handleResponse(res);
}

export async function registerParticipant(role: string, yearsSigning?: number, primaryLanguage?: string): Promise<Participant> {
  const res = await fetch(`${API_BASE}/api/evaluation/participant`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      role,
      years_signing: yearsSigning,
      primary_language: primaryLanguage,
    }),
  });
  return handleResponse<Participant>(res);
}

export async function submitEvaluationResponse(data: EvaluationResponse) {
  const res = await fetch(`${API_BASE}/api/evaluation/response`, {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(data),
  });
  return handleResponse(res);
}
