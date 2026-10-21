"use client";

import Link from "next/link";
import { createContext, useContext, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { usePathname } from "next/navigation";
import { Home, Menu, Moon, Sun, X } from "lucide-react";
import { AuthProvider } from "@/context/AuthContext";
import { OrgProvider, useOrg } from "@/context/OrgContext";
import { ThemeProvider, useTheme } from "@/context/ThemeContext";

type OrgMobileNavContextValue = {
    mobileSidebarOpen: boolean;
    setMobileSidebarOpen: Dispatch<SetStateAction<boolean>>;
};

const OrgMobileNavContext = createContext<OrgMobileNavContextValue | null>(null);

export function useOrgMobileNav() {
    const context = useContext(OrgMobileNavContext);

    if (!context) {
        throw new Error("useOrgMobileNav must be used within AppChrome.");
    }

    return context;
}

function AppHeader({ children }: { children: React.ReactNode }) {
    const { theme, setTheme } = useTheme();
    const pathname = usePathname();
    const { mobileSidebarOpen, setMobileSidebarOpen } = useOrgMobileNav();
    const { activeOrg } = useOrg();
    const showOrgMenu = pathname.startsWith("/org/");

    const routeOrgMatch = pathname.match(/^\/org\/([^/]+)/);
    const currentOrgId = routeOrgMatch ? routeOrgMatch[1] : (activeOrg?.orgId ? encodeURIComponent(activeOrg.orgId) : null);
    const orgHomeHref = currentOrgId ? `/org/${currentOrgId}` : null;
    const isHomeActive = Boolean(orgHomeHref && (pathname === orgHomeHref || pathname === `${orgHomeHref}/`));

    return (
        <>
            <nav className="nav-bar">
                <div className="nav-logo">
                    {showOrgMenu && (
                        <button
                            type="button"
                            className="org-header-toggle"
                            aria-label={mobileSidebarOpen ? "Close navigation menu" : "Open navigation menu"}
                            aria-expanded={mobileSidebarOpen}
                            onClick={() => setMobileSidebarOpen((current) => !current)}
                        >
                            {mobileSidebarOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    )}
                    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="3" y="3" width="7" height="7"></rect>
                        <rect x="14" y="3" width="7" height="7"></rect>
                        <rect x="14" y="14" width="7" height="7"></rect>
                        <rect x="3" y="14" width="7" height="7"></rect>
                    </svg>
                    InvPro
                </div>
                <div className="nav-links">
                    <Link
                        href="/"
                        className={`nav-link ${showOrgMenu ? "org-dashboard-nav-link" : ""}`}
                    >
                        Dashboard
                    </Link>
                    {showOrgMenu && orgHomeHref && (
                        <Link
                            href={orgHomeHref}
                            className={`org-mobile-home-btn ${isHomeActive ? "active" : ""}`}
                            aria-label="Organization home"
                            title="Organization home"
                            onClick={() => setMobileSidebarOpen(false)}
                        >
                            <Home size={18} />
                        </Link>
                    )}
                    <div className="theme-toggle" role="group" aria-label="Theme selector">
                        <button type="button" aria-label="Use light theme" className={`theme-toggle-btn ${theme === "light" ? "active" : ""}`} onClick={() => setTheme("light")}>
                            <Sun size={16} /> <span className="theme-toggle-label">Light</span>
                        </button>
                        <button type="button" aria-label="Use dark theme" className={`theme-toggle-btn ${theme === "dark" ? "active" : ""}`} onClick={() => setTheme("dark")}>
                            <Moon size={16} /> <span className="theme-toggle-label">Dark</span>
                        </button>
                    </div>
                </div>
            </nav>
            {children}
        </>
    );
}

export default function AppChrome({ children }: { children: React.ReactNode }) {
    const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
    const mobileNavValue = useMemo(
        () => ({ mobileSidebarOpen, setMobileSidebarOpen }),
        [mobileSidebarOpen]
    );

    return (
        <ThemeProvider>
            <AuthProvider>
                <OrgProvider>
                    <OrgMobileNavContext.Provider value={mobileNavValue}>
                        <AppHeader>{children}</AppHeader>
                    </OrgMobileNavContext.Provider>
                </OrgProvider>
            </AuthProvider>
        </ThemeProvider>
    );
}
