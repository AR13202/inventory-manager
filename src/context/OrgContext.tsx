// src/context/OrgContext.tsx
"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { useAuth } from "./AuthContext";
import { getOrganizationsForUser } from "@/utils/firebaseHelpers/orgs";

interface OrgContextType {
    organizations: any[];
    activeOrg: any | null;
    setActiveOrg: (org: any) => void;
    refreshOrgs: () => Promise<void>;
    loading: boolean;
}

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
    const [organizations, setOrganizations] = useState<any[]>([]);
    const [activeOrg, setActiveOrg] = useState<any | null>(null);
    const [loading, setLoading] = useState(true);

    const refreshOrgs = async () => {
        if (!user) {
            setOrganizations([]);
            setActiveOrg(null);
            setLoading(false);
            return;
        }

        setLoading(true);
        const { orgs } = await getOrganizationsForUser(user.uid);
        setOrganizations(orgs);

        // If no active org but we have orgs, set the first one as active
        if (!activeOrg && orgs.length > 0) {
            setActiveOrg(orgs[0]);
        }
        setLoading(false);
    };

    useEffect(() => {
        refreshOrgs();
    }, [user]);

    return (
        <OrgContext.Provider value={{ organizations, activeOrg, setActiveOrg, refreshOrgs, loading }}>
            {children}
        </OrgContext.Provider>
    );
};
