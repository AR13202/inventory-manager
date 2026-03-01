"use client";

import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { removeUserFromOrg } from "@/utils/firebaseHelpers/orgs";
import { format } from "date-fns";
import { useState } from "react";
import { UserMinus } from "lucide-react";

export default function UsersList() {
    const { user } = useAuth();
    const { activeOrg, refreshOrgs } = useOrg();
    const [loadingIds, setLoadingIds] = useState<Record<string, boolean>>({});
    const [error, setError] = useState<string | null>(null);

    if (!activeOrg || !user) return <p>Loading members...</p>;

    const handleRemoveUser = async (targetUid: string) => {
        if (!confirm("Are you sure you want to remove this user from the organization?")) return;

        setError(null);
        setLoadingIds(prev => ({ ...prev, [targetUid]: true }));

        const { success, error } = await removeUserFromOrg(activeOrg.orgId, targetUid, user.uid);

        if (error) {
            setError(error);
        } else {
            await refreshOrgs();
        }

        setLoadingIds(prev => ({ ...prev, [targetUid]: false }));
    };

    const isAdmin = activeOrg.adminUid === user.uid;

    return (
        <div>
            <div className="flex-between" style={{ marginBottom: '32px' }}>
                <div>
                    <h1 style={{ fontSize: '2rem', marginBottom: '8px' }}>Organization Members</h1>
                    <p style={{ opacity: 0.7 }}>Manage who has access to {activeOrg.name}'s inventory.</p>
                </div>
            </div>

            {error && (
                <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px', marginBottom: '24px', fontSize: '0.875rem' }}>
                    {error}
                </div>
            )}

            <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                    <thead style={{ background: 'var(--border-color)' }}>
                        <tr>
                            <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>Name</th>
                            <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>Role</th>
                            <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)' }}>Joined Date</th>
                            {isAdmin && (
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, borderBottom: '1px solid var(--border-color)', textAlign: 'right' }}>Actions</th>
                            )}
                        </tr>
                    </thead>
                    <tbody>
                        {(activeOrg.members || []).map((member: any, i: number) => {
                            const memberIsAdmin = member.uid === activeOrg.adminUid;
                            const isSelf = member.uid === user.uid;

                            return (
                                <tr key={member.uid} style={{ borderBottom: i < activeOrg.members.length - 1 ? '1px solid var(--border-color)' : 'none', transition: 'var(--transition)' }} className="table-row-hover">
                                    <td style={{ padding: '16px 24px', fontWeight: 500 }}>
                                        {member.name}
                                        {isSelf && <span style={{ marginLeft: '8px', fontSize: '0.75rem', opacity: 0.5, fontWeight: 'normal' }}>(You)</span>}
                                    </td>
                                    <td style={{ padding: '16px 24px' }}>
                                        <span style={{
                                            display: 'inline-block',
                                            padding: '4px 12px',
                                            borderRadius: '999px',
                                            fontSize: '0.75rem',
                                            fontWeight: 600,
                                            background: memberIsAdmin ? 'rgba(99, 102, 241, 0.1)' : 'var(--border-color)',
                                            color: memberIsAdmin ? 'var(--primary-color)' : 'var(--text-color)'
                                        }}>
                                            {memberIsAdmin ? 'Admin' : 'Member'}
                                        </span>
                                    </td>
                                    <td style={{ padding: '16px 24px', opacity: 0.8, fontSize: '0.875rem' }}>
                                        {member.joinedAt ? format(new Date(member.joinedAt), 'MMM dd, yyyy') : 'Unknown'}
                                    </td>

                                    {isAdmin && (
                                        <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                            {!memberIsAdmin && (
                                                <button
                                                    onClick={() => handleRemoveUser(member.uid)}
                                                    disabled={loadingIds[member.uid]}
                                                    style={{
                                                        color: '#ef4444',
                                                        display: 'inline-flex',
                                                        alignItems: 'center',
                                                        gap: '8px',
                                                        fontSize: '0.875rem',
                                                        fontWeight: 500,
                                                        opacity: loadingIds[member.uid] ? 0.5 : 1,
                                                        cursor: loadingIds[member.uid] ? 'not-allowed' : 'pointer'
                                                    }}
                                                >
                                                    <UserMinus size={16} /> {loadingIds[member.uid] ? 'Removing...' : 'Remove'}
                                                </button>
                                            )}
                                        </td>
                                    )}
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
