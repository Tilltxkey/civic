"use client";
/**
 * UserSync.tsx
 * Pushes user from page.tsx into ProfileContext.
 *
 * KEY CHANGE: We now sync on every change to the user object,
 * not just on mount. This means when page.tsx calls onUserRefresh()
 * and sets fresh user state (with updated badge/role), ProfileContext
 * is updated in the same render cycle — no reload needed.
 *
 * Profile photo is still only restored once per session (on mount)
 * to avoid overwriting a photo the user just picked.
 */
import { useEffect, useRef } from "react";
import { useProfile } from "./ProfileContext";
import type { UserProfile } from "./AuthFlow";

export function UserSync({ user }: { user: UserProfile }) {
  const { setUser, setProfilePic } = useProfile();
  const restoredRef = useRef(false);

  // Sync the full user object into ProfileContext on every change.
  // This is what makes badge and role updates (from onUserRefresh in page.tsx)
  // appear instantly across AppMenu, CommunityTab, Header, etc.
  useEffect(() => {
    setUser(user);
  }, [user, setUser]);

  // Restore saved profile photo from DB — only once per session.
  // After that, AppMenu manages profilePic directly via setProfilePic.
  useEffect(() => {
    if (!restoredRef.current) {
      restoredRef.current = true;
      if (user.profilePhoto) {
        setProfilePic(user.profilePhoto);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.id]); // only re-run if a different user logs in
}