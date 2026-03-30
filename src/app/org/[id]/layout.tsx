"use client";

import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { useRouter } from "next/navigation";
import React, { useEffect } from "react";
import Link from "next/link";
import { Settings, Users, Box, Home, FileText } from "lucide-react";

export default function OrgLayout({
    children,
    params,
}: {
    children: React.ReactNode;
    params: Promise<{ id: string }>;
}) {
    const { user, loading: authLoading } = useAuth();
    const { activeOrg, organizations, loading: orgLoading } = useOrg();
    const router = useRouter();

    useEffect(() => {
        if (!authLoading && !user) {
            router.push("/login");
        }
    }, [user, authLoading, router]);

    if (authLoading || orgLoading) {
        return (
            <main className="container flex-center" style={{ minHeight: 'calc(100vh - 64px)' }}>
                <p>Loading organization...</p>
            </main>
        );
    }

    if (!user) return null;

    if (!user.emailVerified) {
        return (
            <main className="container flex-center" style={{ minHeight: 'calc(100vh - 64px)', flexDirection: 'column', gap: '16px' }}>
                <h2>Verify Your Email</h2>
                <p>Please check your inbox to verify your account before accessing this organization.</p>
                <Link href="/" className="btn-primary">Return to Dashboard</Link>
            </main>
        );
    }

    // Ensure user has access and we have an active org
    const resolvedParams = React.use(params);
    if (!activeOrg || !organizations.some(o => o.orgId === resolvedParams.id)) {
        return (
            <main className="container flex-center" style={{ minHeight: 'calc(100vh - 64px)', flexDirection: 'column', gap: '16px' }}>
                <h2>Organization Not Found</h2>
                <p>You do not have access to this organization or it does not exist.</p>
                <Link href="/" className="btn-primary">Return to Dashboard</Link>
            </main>
        );
    }

    return (
        <div style={{ display: 'flex', minHeight: 'calc(100vh - 67px)' }}>
            {/* Sidebar specific to the organization */}
            <aside style={{ width: '250px', borderRight: '1px solid var(--border-color)', background: 'var(--glass-bg)', padding: '24px 16px' }}>
                <div style={{ marginBottom: '32px', padding: '0 12px' }}>
                    <h2 style={{ fontSize: '1.25rem', marginBottom: '4px' }}>{activeOrg.name}</h2>
                    <p style={{ fontSize: '0.75rem', opacity: 0.6, fontFamily: 'var(--font-geist-mono)' }}>ID: {activeOrg.orgId}</p>
                </div>

                <nav style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <Link href={`/org/${activeOrg.orgId}`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '8px', transition: 'var(--transition)' }} className="table-row-hover">
                        <Box size={18} /> Inventory
                    </Link>
                    <Link href={`/org/${activeOrg.orgId}/companies`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '8px', transition: 'var(--transition)' }} className="table-row-hover">
                        <Home size={18} /> Companies
                    </Link>
                    <Link href={`/org/${activeOrg.orgId}/bills`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '8px', transition: 'var(--transition)' }} className="table-row-hover">
                        <FileText size={18} /> Bills
                    </Link>
                    <Link href={`/org/${activeOrg.orgId}/users`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '8px', transition: 'var(--transition)' }} className="table-row-hover">
                        <Users size={18} /> Members
                    </Link>
                    {activeOrg.adminUid === user?.uid && (
                        <Link href={`/org/${activeOrg.orgId}/settings`} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '12px', borderRadius: '8px', transition: 'var(--transition)' }} className="table-row-hover">
                            <Settings size={18} /> Settings
                        </Link>
                    )}
                </nav>
            </aside>

            {/* Main Content Area */}
            <div style={{ flex: 1, padding: '32px 48px', overflowY: 'auto' }}>
                {children}
            </div>
        </div>
    );
}
