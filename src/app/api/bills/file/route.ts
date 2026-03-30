import { NextRequest, NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY || process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.NEXT_PUBLIC_CLOUDINARY_API_SECRET;

cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret
});

export async function GET(request: NextRequest) {
    const publicId = request.nextUrl.searchParams.get("publicId");
    const resourceType = request.nextUrl.searchParams.get("resourceType") || "image";

    if (!publicId || !publicId.startsWith("inventory_bills/")) {
        return NextResponse.json({ error: "Invalid file reference." }, { status: 400 });
    }

    if (!cloudName || !apiKey || !apiSecret) {
        return NextResponse.json({ error: "Cloudinary is not configured." }, { status: 500 });
    }

    const signedUrl = cloudinary.url(publicId, {
        secure: true,
        sign_url: true,
        type: "authenticated",
        resource_type: resourceType as "image" | "raw" | "video",
        attachment: false
    });

    return NextResponse.redirect(signedUrl);
}
