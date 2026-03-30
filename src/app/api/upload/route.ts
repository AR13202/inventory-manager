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

        const { image } = await request.json();
        if (!image) {
            return NextResponse.json({ success: false, error: "No image provided." }, { status: 400 });
        }

        const uploadResponse = await cloudinary.uploader.upload(image, {
            folder: "inventory_bills",
            resource_type: "image",
            type: "authenticated",
            overwrite: false,
            invalidate: true
        });

        return NextResponse.json({
            success: true,
            url: `/api/bills/image?publicId=${encodeURIComponent(uploadResponse.public_id)}`,
            publicId: uploadResponse.public_id
        });
    } catch (error: any) {
        console.error("Cloudinary upload error:", error);
        return NextResponse.json(
            { success: false, error: error.message || "Error uploading to Cloudinary." },
            { status: 500 }
        );
    }
}
