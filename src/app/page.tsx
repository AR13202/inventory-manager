"use client";

import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { createOrganization, joinOrganization } from "@/utils/firebaseHelpers/orgs";
import { PlusCircle, LogIn, Settings, Users, Box, LogOut } from "lucide-react";
import { logoutUser } from "@/utils/firebaseHelpers/auth";
import { sendEmailVerification } from "firebase/auth";

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const { organizations, activeOrg, setActiveOrg, refreshOrgs, loading: orgLoading } = useOrg();
  const router = useRouter();

  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [showJoinOrg, setShowJoinOrg] = useState(false);

  // Forms state
  const [orgName, setOrgName] = useState("");
  const [orgPassword, setOrgPassword] = useState("");
  const [orgIdToJoin, setOrgIdToJoin] = useState("");

  const [actionLoading, setActionLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) {
      router.push("/login");
    }
  }, [user, authLoading, router]);

  if (authLoading || orgLoading) {
    return (
      <main className="container flex-center" style={{ minHeight: 'calc(100vh - 64px)' }}>
        <p>Loading your portal...</p>
      </main>
    );
  }

  if (!user) return null;

  const handleLogout = async () => {
    await logoutUser();
    router.push("/login");
  };

  const handleResendVerification = async () => {
    try {
      await sendEmailVerification(user);
      alert("Verification email essentially sent. Check your inbox.");
    } catch (e: any) {
      alert("Error sending email: " + e.message);
    }
  }

  if (!user.emailVerified) {
    return (
      <main className="container flex-center" style={{ minHeight: 'calc(100vh - 64px)', flexDirection: 'column', gap: '16px', textAlign: 'center' }}>
        <h2>Verify Your Email</h2>
        <p>Please check your inbox to verify your account before accessing the dashboard.</p>
        <div style={{ display: 'flex', gap: '12px' }}>
          <button onClick={handleResendVerification} className="btn-primary">Resend Verification Email</button>
          <button onClick={handleLogout} className="btn-primary" style={{ background: 'transparent', color: 'var(--text-color)', border: '1px solid var(--border-color)', boxShadow: 'none' }}>
            Sign Out
          </button>
        </div>
      </main>
    );
  }

  const handleCreateOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setActionLoading(true);

    const { error } = await createOrganization(orgName, orgPassword, user, user.displayName || user.email || "Unknown");

    if (error) {
      setError(error);
    } else {
      await refreshOrgs();
      setShowCreateOrg(false);
      setOrgName("");
      setOrgPassword("");
    }
    setActionLoading(false);
  };

  const handleJoinOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setActionLoading(true);

    const { error } = await joinOrganization(orgIdToJoin, orgPassword, user, user.displayName || user.email || "Unknown");

    if (error) {
      setError(error);
    } else {
      await refreshOrgs();
      setShowJoinOrg(false);
      setOrgIdToJoin("");
      setOrgPassword("");
    }
    setActionLoading(false);
  };

  // End of handlers

  return (
    <main className="container">
      <header className="dashboard-header flex-between">
        <div>
          <h1>Welcome, {user.displayName || "User"}</h1>
          <p>Manage your organizations and inventory.</p>
        </div>
        <button onClick={handleLogout} className="btn-primary" style={{ background: 'transparent', color: 'var(--text-color)', border: '1px solid var(--border-color)', boxShadow: 'none' }}>
          <LogOut size={18} style={{ marginRight: '8px' }} /> Sign Out
        </button>
      </header>

      <section style={{ marginTop: '32px' }}>
        <div className="flex-between" style={{ marginBottom: '24px' }}>
          <h2>Your Organizations</h2>
          <div style={{ display: 'flex', gap: '12px' }}>
            <button onClick={() => setShowJoinOrg(true)} className="btn-primary" style={{ background: 'var(--surface-color)', color: 'var(--text-color)', border: '1px solid var(--border-color)', boxShadow: 'var(--shadow-sm)' }}>
              <LogIn size={18} style={{ marginRight: '8px' }} /> Join
            </button>
            <button onClick={() => setShowCreateOrg(true)} className="btn-primary">
              <PlusCircle size={18} style={{ marginRight: '8px' }} /> Create
            </button>
          </div>
        </div>

        {organizations.length === 0 ? (
          <div className="glass-panel flex-center" style={{ padding: '64px 24px', flexDirection: 'column', gap: '16px', textAlign: 'center' }}>
            <Box size={48} style={{ opacity: 0.5 }} />
            <h3>No Organizations Found</h3>
            <p style={{ opacity: 0.7, maxWidth: '400px' }}>You aren't a member of any organizations yet. Create a new one or join an existing organization to start managing inventory.</p>
          </div>
        ) : (
          <div className="grid-dashboard">
            {organizations.map((org) => (
              <div
                key={org.orgId}
                className="glass-panel"
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '16px',
                  border: activeOrg?.orgId === org.orgId ? '2px solid var(--primary-color)' : '1px solid var(--border-color)',
                  cursor: 'pointer'
                }}
                onClick={() => {
                  setActiveOrg(org);
                  router.push(`/org/${org.orgId}`);
                }}
              >
                <div className="flex-between">
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    {org.logoPublicId ? (
                      <img
                        src={`/api/bills/file?publicId=${encodeURIComponent(org.logoPublicId)}&resourceType=${encodeURIComponent(org.logoResourceType || "image")}`}
                        alt={`${org.name} logo`}
                        style={{ width: '44px', height: '44px', objectFit: 'cover', borderRadius: '12px' }}
                      />
                    ) : (
                      <div style={{ width: '44px', height: '44px', borderRadius: '12px', background: 'var(--surface-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <Box size={18} />
                      </div>
                    )}
                    <h3 style={{ fontSize: '1.25rem' }}>{org.name}</h3>
                  </div>
                  {org.adminUid === user.uid && (
                    <span style={{ fontSize: '0.75rem', padding: '4px 8px', background: 'var(--primary-color)', color: 'white', borderRadius: '4px', fontWeight: 600 }}>ADMIN</span>
                  )}
                </div>

                <div style={{ display: 'flex', gap: '16px', marginTop: 'auto', paddingTop: '16px', borderTop: '1px solid var(--border-color)', opacity: 0.8, fontSize: '0.875rem' }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Users size={16} /> {org.members?.length || 0} Members
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <Box size={16} /> Inventory
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Modals for Create/Join (Simplified UI using simple absolute positioning for brevity) */}
      {(showCreateOrg || showJoinOrg) && (
        <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 1000, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="glass-panel" style={{ width: '100%', maxWidth: '400px', background: 'var(--surface-color)', position: 'relative' }}>
            <button
              onClick={() => {
                setShowCreateOrg(false);
                setShowJoinOrg(false);
                setError(null);
              }}
              style={{ position: 'absolute', top: '16px', right: '16px', opacity: 0.5, fontSize: '1.5rem', lineHeight: 1 }}
            >
              &times;
            </button>

            <h2 style={{ marginBottom: '24px' }}>
              {showCreateOrg ? "Create Organization" : "Join Organization"}
            </h2>

            {error && (
              <div style={{ padding: '12px', background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', borderRadius: '8px', marginBottom: '20px', fontSize: '0.875rem' }}>
                {error}
              </div>
            )}

            <form onSubmit={showCreateOrg ? handleCreateOrg : handleJoinOrg} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {showJoinOrg ? (
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Organization ID</label>
                  <input
                    type="text"
                    required
                    value={orgIdToJoin}
                    onChange={(e) => setOrgIdToJoin(e.target.value)}
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }}
                  />
                </div>
              ) : (
                <div>
                  <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Organization Name</label>
                  <input
                    type="text"
                    required
                    value={orgName}
                    onChange={(e) => setOrgName(e.target.value)}
                    style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }}
                  />
                </div>
              )}

              <div>
                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Password</label>
                <input
                  type="password"
                  required
                  value={orgPassword}
                  onChange={(e) => setOrgPassword(e.target.value)}
                  style={{ width: '100%', padding: '12px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }}
                />
              </div>

              <button
                type="submit"
                className="btn-primary"
                style={{ width: '100%', marginTop: '8px', padding: '12px' }}
                disabled={actionLoading}
              >
                {actionLoading ? "Processing..." : (showCreateOrg ? "Create" : "Join")}
              </button>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
