"use client";

import React, { createContext, useContext, useState, useEffect, useCallback } from "react";
import {
  UserProfile,
  fetchCurrentUser,
  getStoredToken,
  loginUser,
  logoutUser,
  registerUser,
  setStoredToken,
} from "@/lib/api";

interface AuthContextValue {
  user: UserProfile | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<UserProfile>;
  register: (payload: {
    email: string;
    username: string;
    full_name: string;
    password: string;
    role: string;
    preferred_variant: string;
    preferred_style?: string;
    avatar_model?: string;
    bio?: string;
  }) => Promise<UserProfile>;
  logout: () => Promise<void>;
  quickDemoLogin: (demoAccount: "maya" | "alex" | "sophie") => Promise<UserProfile>;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const DEMO_CREDENTIALS: Record<"maya" | "alex" | "sophie", { email: string; pass: string }> = {
  maya: { email: "maya@signavatar.ai", pass: "SignAvatar#2026" },
  alex: { email: "alex@signavatar.ai", pass: "SignAvatar#2026" },
  sophie: { email: "sophie@signavatar.ai", pass: "SignAvatar#2026" },
};

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const refreshUser = useCallback(async () => {
    const token = getStoredToken();
    if (!token) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const profile = await fetchCurrentUser();
      setUser(profile);
    } catch {
      setStoredToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUser();
  }, [refreshUser]);

  const login = useCallback(async (email: string, password: string) => {
    const res = await loginUser(email, password);
    setUser(res.user);
    return res.user;
  }, []);

  const register = useCallback(
    async (payload: {
      email: string;
      username: string;
      full_name: string;
      password: string;
      role: string;
      preferred_variant: string;
      preferred_style?: string;
      avatar_model?: string;
      bio?: string;
    }) => {
      const res = await registerUser(payload);
      setUser(res.user);
      return res.user;
    },
    []
  );

  const logout = useCallback(async () => {
    await logoutUser();
    setUser(null);
  }, []);

  const quickDemoLogin = useCallback(async (demoAccount: "maya" | "alex" | "sophie") => {
    const creds = DEMO_CREDENTIALS[demoAccount];
    const res = await loginUser(creds.email, creds.pass);
    setUser(res.user);
    return res.user;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        logout,
        quickDemoLogin,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return ctx;
}
