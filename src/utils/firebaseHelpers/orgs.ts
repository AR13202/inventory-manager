// src/utils/firebaseHelpers/orgs.ts
import {
    collection,
    doc,
    setDoc,
    getDoc,
    query,
    where,
    getDocs,
    updateDoc,
    arrayUnion,
    arrayRemove
} from "firebase/firestore";
import { db } from "../firebase";
import { User } from "firebase/auth";

// Create Organization
export const createOrganization = async (name: string, password: string, currentUser: User, currentUserName: string) => {
    try {
        const orgRef = doc(collection(db, "organizations"));
        const orgId = orgRef.id;

        const newOrg = {
            orgId,
            name,
            password, // Note: In production, consider hashing this!
            adminUid: currentUser.uid,
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

// Join Organization
export const joinOrganization = async (orgId: string, password: string, currentUser: User, currentUserName: string) => {
    try {
        const orgRef = doc(db, "organizations", orgId);
        const orgSnap = await getDoc(orgRef);

        if (!orgSnap.exists()) {
            return { success: false, error: "Organization not found." };
        }

        const orgData = orgSnap.data();

        // Check password
        if (orgData.password !== password) {
            return { success: false, error: "Incorrect password." };
        }

        // Check if user is already a member
        const isMember = orgData.members.some((member: any) => member.uid === currentUser.uid);
        if (isMember) {
            return { success: false, error: "You are already a member of this organization." };
        }

        // Add user to members array
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

// Get User's Organizations
export const getOrganizationsForUser = async (uid: string) => {
    try {
        // We fetch all orgs and filter where user is in members array
        // Since Firestore doesn't natively query deeply nested arrays of objects well 
        // without structural changes, and this is typically a small dataset per user:
        const orgsRef = collection(db, "organizations");
        const snapshot = await getDocs(orgsRef);

        const userOrgs: any[] = [];
        snapshot.forEach(doc => {
            const data = doc.data();
            if (data.members && data.members.some((m: any) => m.uid === uid)) {
                userOrgs.push(data);
            }
        });

        return { orgs: userOrgs, error: null };
    } catch (error: any) {
        return { orgs: [], error: error.message };
    }
};

// Remove User from Organization
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
