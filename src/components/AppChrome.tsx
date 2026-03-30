"use client";

import Link from "next/link";
import { Moon, Sun } from "lucide-react";
import { AuthProvider } from "@/context/AuthContext";
import { OrgProvider } from "@/context/OrgContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";

function AppHeader({ children }: { children: React.ReactNode }) {
    const { theme, setTheme } = useTheme();

    return (
        <>
            <nav className="nav-bar">
                <div className="nav-logo">
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7"></rect>
                        <rect x="14" y="3" width="7" height="7"></rect>
                        <rect x="14" y="14" width="7" height="7"></rect>
                        <rect x="3" y="14" width="7" height="7"></rect>
                    </svg>
                    InvPro
                </div>
                <div className="nav-links">
                    <Link href="/" className="nav-link">Dashboard</Link>
                    <div className="theme-toggle" role="group" aria-label="Theme selector">
                        <button type="button" className={`theme-toggle-btn ${theme === "light" ? "active" : ""}`} onClick={() => setTheme("light")}>
                            <Sun size={16} /> Light
                        </button>
                        <button type="button" className={`theme-toggle-btn ${theme === "dark" ? "active" : ""}`} onClick={() => setTheme("dark")}>
                            <Moon size={16} /> Dark
                        </button>
                    </div>
                </div>
            </nav>
            {children}
        </>
    );
}

export default function AppChrome({ children }: { children: React.ReactNode }) {
    return (
        <ThemeProvider>
            <AuthProvider>
                <OrgProvider>
                    <AppHeader>{children}</AppHeader>
                </OrgProvider>
            </AuthProvider>
        </ThemeProvider>
    );
}
