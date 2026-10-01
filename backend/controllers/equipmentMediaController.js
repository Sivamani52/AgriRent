import cloudinary from "../config/cloudinary.js";
import pool from "../config/db.js";

const uploadToCloudinary = (file) => {
    return new Promise((resolve, reject) => {
        const resourceType = file.mimetype.startsWith("video/")
            ? "video"
            : "image";

        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "agrirent/equipment",
                resource_type: resourceType
            },
            (error, result) => {
                if (error) {
                    reject(error);
                } else {
                    resolve(result);
                }
            }
        );

        stream.end(file.buffer);
    });
};

export const uploadEquipmentMedia = async (req, res) => {
    try {
        const { equipmentId } = req.params;

        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Image or video is required"
            });
        }

        const [equipment] = await pool.query(
            "SELECT id FROM equipment WHERE id = ?",
            [equipmentId]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        const result = await uploadToCloudinary(req.file);

        const mediaType = req.file.mimetype.startsWith("video/")
            ? "VIDEO"
            : "IMAGE";

        const uploadedBy = req.user.id;

        const [insertResult] = await pool.query(
            `INSERT INTO equipment_media
            (equipment_id, media_type, file_url, uploaded_by)
            VALUES (?, ?, ?, ?)`,
            [
                equipmentId,
                mediaType,
                result.secure_url,
                uploadedBy
            ]
        );

        res.status(201).json({
            success: true,
            message: "Media uploaded successfully",
            data: {
                id: insertResult.insertId,
                equipmentId,
                mediaType,
                fileUrl: result.secure_url
            }
        });

    } catch (error) {
        console.error("Upload equipment media error:", error);

        res.status(500).json({
            success: false,
            message: "Failed to upload media"
        });
    }
};