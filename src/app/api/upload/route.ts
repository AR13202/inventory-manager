import { NextResponse } from "next/server";
import { v2 as cloudinary } from "cloudinary";

const cloudName = process.env.CLOUDINARY_CLOUD_NAME || process.env.NEXT_PUBLIC_CLOUDINARY_CLOUD_NAME;
const apiKey = process.env.CLOUDINARY_API_KEY || process.env.NEXT_PUBLIC_CLOUDINARY_API_KEY;
const apiSecret = process.env.CLOUDINARY_API_SECRET || process.env.NEXT_PUBLIC_CLOUDINARY_API_SECRET;

cloudinary.config({
    cloud_name: cloudName,
    api_key: apiKey,
    api_secret: apiSecret
});

export async function POST(request: Request) {
    try {
        if (!cloudName || !apiKey || !apiSecret) {
            return NextResponse.json({ success: false, error: "Cloudinary is not configured." }, { status: 500 });
        }

        const { file, fileName, mimeType } = await request.json();
        if (!file) {
            return NextResponse.json({ success: false, error: "No file provided." }, { status: 400 });
        }

        const isPdf = String(mimeType || "").includes("pdf");
        const resourceType = isPdf ? "raw" : "image";
        const uploadResponse = await cloudinary.uploader.upload(file, {
            folder: "inventory_bills",
            resource_type: resourceType,
            type: "authenticated",
            overwrite: false,
            invalidate: true,
            use_filename: true,
            filename_override: fileName || undefined
        });

        return NextResponse.json({
            success: true,
            publicId: uploadResponse.public_id,
            resourceType: uploadResponse.resource_type,
            url: `/api/bills/file?publicId=${encodeURIComponent(uploadResponse.public_id)}&resourceType=${encodeURIComponent(uploadResponse.resource_type)}`
        });
    } catch (error: any) {
        console.error("Cloudinary upload error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Error uploading to Cloudinary." },
            { status: 500 }
        );
    }
}
