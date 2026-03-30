// src/context/AuthContext.tsx
"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { onAuthStateChanged, signOut, User } from "firebase/auth";
import { auth, db } from "../utils/firebase";
import { doc, getDoc } from "firebase/firestore";

interface AuthContextType {
    user: User | null;
    userData: any | null;
    loading: boolean;
}

const AuthContext = createContext<AuthContextType>({
    user: null,
    userData: null,
    loading: true,
});

export const useAuth = () => useContext(AuthContext);

const SESSION_RESET_KEY = "inventory-manager-session-reset-at";

const getNextMidnight = () => {
    const next = new Date();
    next.setHours(24, 0, 0, 0);
    return next.getTime();
};

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
    const [user, setUser] = useState<User | null>(null);
    const [userData, setUserData] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        let resetTimer: ReturnType<typeof setTimeout> | null = null;

        const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
            if (resetTimer) {
                clearTimeout(resetTimer);
                resetTimer = null;
            }

            setUser(currentUser);

            if (currentUser) {
                const now = Date.now();
                const storedResetAt = Number(window.localStorage.getItem(SESSION_RESET_KEY) || 0);
                const resetAt = storedResetAt > now ? storedResetAt : getNextMidnight();

                if (storedResetAt && storedResetAt <= now) {
                    window.localStorage.removeItem(SESSION_RESET_KEY);
                    await signOut(auth);
                    setUser(null);
                    setUserData(null);
                    setLoading(false);
                    return;
                }

                window.localStorage.setItem(SESSION_RESET_KEY, String(resetAt));
                resetTimer = setTimeout(async () => {
                    window.localStorage.removeItem(SESSION_RESET_KEY);
                    await signOut(auth);
                }, Math.max(resetAt - now, 0));

                // Fetch additional user data from Firestore
                try {
                    const userDoc = await getDoc(doc(db, "users", currentUser.uid));
                    if (userDoc.exists()) {
                        setUserData(userDoc.data());
                    }
                } catch (error) {
                    console.error("Error fetching user data:", error);
                }
            } else {
                window.localStorage.removeItem(SESSION_RESET_KEY);
                setUserData(null);
            }

            setLoading(false);
        });

        return () => {
            if (resetTimer) clearTimeout(resetTimer);
            unsubscribe();
        };
    }, []);

    return (
        <AuthContext.Provider value={{ user, userData, loading }}>
            {!loading && children}
        </AuthContext.Provider>
    );
};
