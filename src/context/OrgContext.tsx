"use client";

import React, { createContext, useContext, useEffect, useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "./AuthContext";
import { getOrganizationsForUser } from "@/utils/firebaseHelpers/orgs";

interface OrgContextType {
    organizations: any[];
    activeOrg: any | null;
    setActiveOrg: (org: any) => void;
    refreshOrgs: () => Promise<void>;
    loading: boolean;
}

const STORAGE_KEY = "inventory-manager.active-org-id";

const OrgContext = createContext<OrgContextType>({
    organizations: [],
    activeOrg: null,
    setActiveOrg: () => { },
    refreshOrgs: async () => { },
    loading: true,
});

export const useOrg = () => useContext(OrgContext);

export const OrgProvider = ({ children }: { children: React.ReactNode }) => {
    const { user } = useAuth();
    const pathname = usePathname();
    const [organizations, setOrganizations] = useState<any[]>([]);
    const [activeOrg, setActiveOrgState] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);

    const routeOrgId = useMemo(() => {
        const match = pathname.match(/^\/org\/([^/]+)/);
        return match ? decodeURIComponent(match[1]) : null;
    }, [pathname]);

    const setActiveOrg = (org: any) => {
        setActiveOrgState(org);
        if (typeof window !== "undefined") {
            if (org?.orgId) {
                window.localStorage.setItem(STORAGE_KEY, org.orgId);
            } else {
                window.localStorage.removeItem(STORAGE_KEY);
            }
        }
    };

    const refreshOrgs = async () => {
        if (!user) {
            setOrganizations([]);
            setActiveOrgState(null);
            setLoading(false);
            if (typeof window !== "undefined") {
                window.localStorage.removeItem(STORAGE_KEY);
            }
            return;
        }

        setLoading(true);
        const { orgs } = await getOrganizationsForUser(user.uid);
        setOrganizations(orgs);

        const storedOrgId = typeof window !== "undefined" ? window.localStorage.getItem(STORAGE_KEY) : null;
        const preferredOrgId = routeOrgId || storedOrgId;
        const preferredOrg = preferredOrgId ? orgs.find((org: any) => org.orgId === preferredOrgId) : null;
        const existingActive = activeOrg?.orgId ? orgs.find((org: any) => org.orgId === activeOrg.orgId) : null;
        const nextActive = preferredOrg || existingActive || orgs[0] || null;

        setActiveOrgState(nextActive);
        if (typeof window !== "undefined") {
            if (nextActive?.orgId) {
                window.localStorage.setItem(STORAGE_KEY, nextActive.orgId);
            } else {
                window.localStorage.removeItem(STORAGE_KEY);
            }
        }
        setLoading(false);
    };

    useEffect(() => {
        refreshOrgs();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [user, routeOrgId]);

    return (
        <OrgContext.Provider value={{ organizations, activeOrg, setActiveOrg, refreshOrgs, loading }}>
            {children}
        </OrgContext.Provider>
    );
};
