"use client";

import React, { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useOrg } from "@/context/OrgContext";
import { useRouter } from "next/navigation";
import { Plus, Search, Building2, X, Edit, Trash2 } from "lucide-react";
import {
    Company,
    subscribeToCompanies,
    addCompanyItem,
    updateCompanyItem,
    deleteCompanyItem
} from "@/utils/firebaseHelpers/companies";

export default function CompaniesView({ params }: { params: Promise<{ id: string }> }) {
    const { user } = useAuth();
    const { activeOrg } = useOrg();
    const router = useRouter();

    const [companies, setCompanies] = useState<Company[]>([]);
    const [loading, setLoading] = useState(true);

    // List Control States
    const [searchQuery, setSearchQuery] = useState("");
    const [sortParam, setSortParam] = useState("Name (A-Z)");

    // Modal states
    const [showModal, setShowModal] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formData, setFormData] = useState({
        name: "",
        gst: "",
        address: "",
        phoneNumbers: ""
    });
    const [actionLoading, setActionLoading] = useState(false);
    const [error, setError] = useState("");

    // Unseal params
    const resolvedParams = React.use(params);

    useEffect(() => {
        if (!user || !activeOrg || activeOrg.orgId !== resolvedParams.id) return;

        const unsubscribe = subscribeToCompanies(activeOrg.orgId, (items) => {
            setCompanies(items);
            setLoading(false);
        });

        return () => unsubscribe();
    }, [user, activeOrg, resolvedParams.id]);

    const handleOpenModal = (company?: Company) => {
        if (company) {
            setEditingId(company.id as string);
            setFormData({
                name: company.name,
                gst: company.gst,
                address: company.address,
                phoneNumbers: company.phoneNumbers
            });
        } else {
            setEditingId(null);
            setFormData({
                name: "",
                gst: "",
                address: "",
                phoneNumbers: ""
            });
        }
        setError("");
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError("");
        setActionLoading(true);

        if (!activeOrg || !user) return;

        if (editingId) {
            const { error: updateError } = await updateCompanyItem(activeOrg.orgId, editingId, formData);
            if (updateError) {
                setError(updateError);
                setActionLoading(false);
                return;
            }
        } else {
            const { error: addError } = await addCompanyItem(activeOrg.orgId, {
                ...formData,
                createdBy: user.uid
            });
            if (addError) {
                setError(addError);
                setActionLoading(false);
                return;
            }
        }

        setShowModal(false);
        setActionLoading(false);
    };

    const handleDelete = async (id: string, name: string) => {
        if (!activeOrg) return;
        if (window.confirm(`Are you sure you want to delete ${name}?`)) {
            await deleteCompanyItem(activeOrg.orgId, id);
        }
    };

    // Filter and Sort Logic
    const filteredAndSortedCompanies = [...companies]
        .filter(comp => {
            if (!searchQuery) return true;
            const q = searchQuery.toLowerCase();
            return (
                comp.name.toLowerCase().includes(q) ||
                (comp.gst && comp.gst.toLowerCase().includes(q)) ||
                (comp.id && comp.id.toLowerCase().includes(q))
            );
        })
        .sort((a, b) => {
            switch (sortParam) {
                case "Name (A-Z)":
                    return a.name.localeCompare(b.name);
                case "Name (Z-A)":
                    return b.name.localeCompare(a.name);
                case "Default":
                default:
                    return 0; // maintain insertion order / created date since subscribe orders by it
            }
        });

    return (
        <div>
            <header className="dashboard-header flex-between" style={{ marginTop: 0 }}>
                <div>
                    <h1 className="dashboard-title">Companies Directory</h1>
                    <p className="dashboard-subtitle">Manage your connections, suppliers, and buyers.</p>
                </div>
                <div>
                    <button onClick={() => handleOpenModal()} className="btn-primary" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Plus size={18} /> Add Company
                    </button>
                </div>
            </header>

            <div className="flex-between" style={{ marginBottom: '16px', gap: '16px', marginTop: '24px' }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <input
                        type="text"
                        placeholder="Search by Name, ID, or GST..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            maxWidth: '400px',
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--surface-color)',
                            color: 'var(--text-color)'
                        }}
                    />
                </div>
                <div>
                    <select
                        value={sortParam}
                        onChange={(e) => setSortParam(e.target.value)}
                        style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--surface-color)',
                            color: 'var(--text-color)',
                            cursor: 'pointer'
                        }}
                    >
                        <option value="Default">Sort By...</option>
                        <option value="Name (A-Z)">Name (A-Z)</option>
                        <option value="Name (Z-A)">Name (Z-A)</option>
                    </select>
                </div>
            </div>

            <div className="glass-panel" style={{ padding: 0, overflow: 'hidden' }}>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ minWidth: '800px', width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                        <thead style={{ background: 'var(--border-color)' }}>
                            <tr>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Company ID</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Name</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>GST Number</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Phone</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7 }}>Address</th>
                                <th style={{ padding: '16px 24px', fontWeight: 500, fontSize: '0.875rem', opacity: 0.7, textAlign: 'right' }}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {loading ? (
                                <tr><td colSpan={6} style={{ padding: '24px', textAlign: 'center' }}>Loading...</td></tr>
                            ) : filteredAndSortedCompanies.length === 0 ? (
                                <tr><td colSpan={6} style={{ padding: '48px', textAlign: 'center', opacity: 0.6 }}>No companies found. Click "Add Company" to get started.</td></tr>
                            ) : (
                                filteredAndSortedCompanies.map((comp, i) => (
                                    <tr key={comp.id} style={{ borderBottom: i < filteredAndSortedCompanies.length - 1 ? '1px solid var(--border-color)' : 'none', transition: 'var(--transition)' }} className="table-row-hover">
                                        <td style={{ padding: '16px 24px', fontFamily: 'var(--font-geist-mono)', fontSize: '0.875rem', opacity: 0.8 }}>
                                            {comp.id}
                                        </td>
                                        <td style={{ padding: '16px 24px', fontWeight: 500 }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                <Building2 size={16} style={{ opacity: 0.5 }} />
                                                {comp.name}
                                            </div>
                                        </td>
                                        <td style={{ padding: '16px 24px', fontFamily: 'var(--font-geist-mono)' }}>{comp.gst || '-'}</td>
                                        <td style={{ padding: '16px 24px' }}>{comp.phoneNumbers || '-'}</td>
                                        <td style={{ padding: '16px 24px', maxWidth: '300px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={comp.address}>
                                            {comp.address || '-'}
                                        </td>
                                        <td style={{ padding: '16px 24px', textAlign: 'right' }}>
                                            <div style={{ display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                                                <button onClick={() => handleOpenModal(comp)} className="btn-secondary" style={{ padding: '6px' }} title="Edit">
                                                    <Edit size={16} />
                                                </button>
                                                <button onClick={() => handleDelete(comp.id as string, comp.name)} className="btn-secondary" style={{ padding: '6px', color: '#ef4444' }} title="Delete">
                                                    <Trash2 size={16} />
                                                </button>
                                            </div>
                                        </td>
                                    </tr>
                                ))
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Add / Edit Modal */}
            {showModal && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.5)', zIndex: 100,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    padding: '20px'
                }}>
                    <div className="glass-panel" style={{ width: '100%', maxWidth: '500px', position: 'relative' }}>
                        <button
                            onClick={() => setShowModal(false)}
                            style={{ position: 'absolute', top: '24px', right: '24px', background: 'none', border: 'none', color: 'var(--text-color)', cursor: 'pointer', opacity: 0.7 }}
                        >
                            <X size={20} />
                        </button>

                        <h2 style={{ fontSize: '1.25rem', marginBottom: '24px' }}>{editingId ? 'Edit Company' : 'Add New Company'}</h2>

                        {error && <div style={{ background: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', padding: '12px', borderRadius: '8px', marginBottom: '16px', fontSize: '0.875rem' }}>{error}</div>}

                        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Company Name*</label>
                                <input
                                    required
                                    type="text"
                                    value={formData.name}
                                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                                    style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }}
                                    placeholder="e.g. Acme Corp"
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>GST Number</label>
                                <input
                                    type="text"
                                    value={formData.gst}
                                    onChange={e => setFormData({ ...formData, gst: e.target.value })}
                                    style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)', fontFamily: 'var(--font-geist-mono)' }}
                                    placeholder="Optional"
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Phone Number(s)</label>
                                <input
                                    type="text"
                                    value={formData.phoneNumbers}
                                    onChange={e => setFormData({ ...formData, phoneNumbers: e.target.value })}
                                    style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)' }}
                                    placeholder="+1 234 567 8900"
                                />
                            </div>

                            <div>
                                <label style={{ display: 'block', marginBottom: '8px', fontSize: '0.875rem', fontWeight: 500 }}>Address</label>
                                <textarea
                                    value={formData.address}
                                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                                    style={{ width: '100%', padding: '10px 16px', borderRadius: '8px', border: '1px solid var(--border-color)', background: 'var(--surface-color)', color: 'var(--text-color)', minHeight: '80px', resize: 'vertical' }}
                                    placeholder="Full address details..."
                                />
                            </div>

                            <div style={{ marginTop: '8px', display: 'flex', gap: '12px' }}>
                                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary" style={{ flex: 1 }}>
                                    Cancel
                                </button>
                                <button type="submit" disabled={actionLoading} className="btn-primary" style={{ flex: 1, display: 'flex', justifyContent: 'center' }}>
                                    {actionLoading ? 'Saving...' : 'Save Company'}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
}
