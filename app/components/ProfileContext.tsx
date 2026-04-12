"use client";

/**
 * ProfileContext.tsx
 * Holds the authenticated user profile app-wide.
 * Components call useProfile() to get/set the current user.
 *
 * IMPORTANT: setUser is called by UserSync on every render where
 * the user object changes (badge, role, etc.), so all consumers
 * of useProfile().user always have the freshest data — no reload needed.
 */

import { createContext, useContext, useState, ReactNode } from "react";
import type { UserProfile } from "./AuthFlow";

interface ProfileCtx {
  user:          UserProfile | null;
  setUser:       (u: UserProfile | null) => void;
  profilePic:    string | null;
  setProfilePic: (url: string | null) => void;
}

const Ctx = createContext<ProfileCtx>({
  user: null,         setUser: () => {},
  profilePic: null,   setProfilePic: () => {},
});

export function ProfileProvider({ children }: { children: ReactNode }) {
  const [user,       setUser]       = useState<UserProfile | null>(null);
  const [profilePic, setProfilePic] = useState<string | null>(null);
  return (
    <Ctx.Provider value={{ user, setUser, profilePic, setProfilePic }}>
      {children}
    </Ctx.Provider>
  );
}

export const useProfile = () => useContext(Ctx);