// src/utils/firebaseHelpers/orgs.ts
import {
    arrayRemove,
    arrayUnion,
    collection,
    doc,
    getDoc,
    getDocs,
    setDoc,
    updateDoc
} from "firebase/firestore";
import { User } from "firebase/auth";
import { db } from "../firebase";

export interface OrganizationProfile {
    orgId: string;
    name: string;
    password: string;
    adminUid: string;
    members: any[];
    address?: string;
    gst?: string;
    bankDetails?: string;
    logoUrl?: string;
    logoPublicId?: string;
    logoResourceType?: "image" | "raw" | "video";
}

export const createOrganization = async (name: string, password: string, currentUser: User, currentUserName: string) => {
    try {
        const orgRef = doc(collection(db, "organizations"));
        const orgId = orgRef.id;

        const newOrg: OrganizationProfile = {
            orgId,
            name,
            password,
            adminUid: currentUser.uid,
            address: "",
            gst: "",
            bankDetails: "",
            logoUrl: "",
            logoPublicId: "",
            logoResourceType: "image",
            members: [{
                uid: currentUser.uid,
                name: currentUserName,
                joinedAt: new Date().toISOString()
            }]
        };

        await setDoc(orgRef, newOrg);
        return { orgId, error: null };
    } catch (error: any) {
        return { orgId: null, error: error.message };
    }
};

export const joinOrganization = async (orgId: string, password: string, currentUser: User, currentUserName: string) => {
    try {
        const orgRef = doc(db, "organizations", orgId);
        const orgSnap = await getDoc(orgRef);

        if (!orgSnap.exists()) {
            return { success: false, error: "Organization not found." };
        }

        const orgData = orgSnap.data();
        if (orgData.password !== password) {
            return { success: false, error: "Incorrect password." };
        }

        const isMember = orgData.members.some((member: any) => member.uid === currentUser.uid);
        if (isMember) {
            return { success: false, error: "You are already a member of this organization." };
        }

        await updateDoc(orgRef, {
            members: arrayUnion({
                uid: currentUser.uid,
                name: currentUserName,
                joinedAt: new Date().toISOString()
            })
        });

        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const getOrganizationsForUser = async (uid: string) => {
    try {
        const orgsRef = collection(db, "organizations");
        const snapshot = await getDocs(orgsRef);
        const userOrgs: any[] = [];

        snapshot.forEach((orgDoc) => {
            const data = orgDoc.data();
            if (data.members && data.members.some((m: any) => m.uid === uid)) {
                userOrgs.push(data);
            }
        });

        return { orgs: userOrgs, error: null };
    } catch (error: any) {
        return { orgs: [], error: error.message };
    }
};

export const updateOrganizationProfile = async (
    orgId: string,
    updates: Partial<Pick<OrganizationProfile, "name" | "address" | "gst" | "bankDetails" | "logoUrl" | "logoPublicId" | "logoResourceType">>
) => {
    try {
        const orgRef = doc(db, "organizations", orgId);
        await updateDoc(orgRef, updates);
        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};

export const removeUserFromOrg = async (orgId: string, targetUid: string, currentUserUid: string) => {
    try {
        const orgRef = doc(db, "organizations", orgId);
        const orgSnap = await getDoc(orgRef);

        if (!orgSnap.exists()) return { success: false, error: "Org not found" };

        const orgData = orgSnap.data();
        if (orgData.adminUid !== currentUserUid) {
            return { success: false, error: "Only the admin can remove users." };
        }

        if (targetUid === currentUserUid) {
            return { success: false, error: "Admin cannot remove themselves." };
        }

        const targetMember = orgData.members.find((m: any) => m.uid === targetUid);
        if (!targetMember) return { success: false, error: "User not in org." };

        await updateDoc(orgRef, {
            members: arrayRemove(targetMember)
        });

        return { success: true, error: null };
    } catch (error: any) {
        return { success: false, error: error.message };
    }
};
