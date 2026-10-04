import cloudinary from "../config/cloudinary.js";
import pool from "../db.js";

/**
 * Uploads a buffer directly to Cloudinary using upload_stream
 * @param {Buffer} fileBuffer - File buffer from multer memoryStorage
 * @param {string} resourceType - "image" | "video"
 * @returns {Promise<object>} - Cloudinary upload result
 */
const uploadToCloudinary = (fileBuffer, resourceType) => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder: "agrirent/equipment",
                resource_type: resourceType
            },
            (error, result) => {
                if (error) {
                    return reject(error);
                }
                resolve(result);
            }
        );

        stream.end(fileBuffer);
    });
};

/**
 * Upload equipment media (Image or Video)
 * Route: POST /api/equipment/:equipmentId/media
 */
export const uploadEquipmentMedia = async (req, res) => {
    try {
        const { equipmentId } = req.params;

        const equipmentIdNumber = Number(equipmentId);

        if (!Number.isInteger(equipmentIdNumber) || equipmentIdNumber <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid equipment ID"
            });
        }

        // 1. Verify file was provided
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: "Image or video is required"
            });
        }

        // 2. Verify that equipment exists in the database
        const [equipment] = await pool.query(
            "SELECT id FROM equipment WHERE id = ?",
            [equipmentIdNumber]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        // 3. Foreign key resolution for uploaded_by
        // TODO: Replace temporary development user ID with authenticated user ID (req.user.id)
        // once JWT authentication middleware is implemented.
        // Currently, auth is not implemented, so we verify a real existing user in the database.
        let uploadedBy = req.body?.uploaded_by || req.body?.uploadedBy;

        if (uploadedBy) {
            const [user] = await pool.query(
                "SELECT id FROM users WHERE id = ?",
                [uploadedBy]
            );

            if (user.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "User not found"
                });
            }
        } else {
            const [existingUsers] = await pool.query(
                "SELECT id FROM users LIMIT 1"
            );

            if (existingUsers.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: "No user found in database. An existing user is required for uploaded_by foreign key."
                });
            }
            uploadedBy = existingUsers[0].id;
        }

        // 4. Detect media type from MIME type
        const isVideo = req.file.mimetype.startsWith("video/");
        const mediaType = isVideo ? "VIDEO" : "IMAGE";
        const resourceType = isVideo ? "video" : "image";

        // 5. Upload file buffer to Cloudinary
        const result = await uploadToCloudinary(req.file.buffer, resourceType);

        // 6. Store Cloudinary secure_url in MySQL equipment_media table
        const [insertResult] = await pool.query(
            `INSERT INTO equipment_media
            (equipment_id, media_type, file_url, public_id, uploaded_by)
            VALUES (?, ?, ?, ?, ?)`,
            [
                equipmentIdNumber,
                mediaType,
                result.secure_url,
                result.public_id,
                uploadedBy
            ]
        );

        // 7. Return generated Cloudinary URL and record in the response
        return res.status(201).json({
            success: true,
            message: "Media uploaded successfully",
            data: {
                id: insertResult.insertId,
                equipmentId: Number(equipmentId),
                mediaType,
                fileUrl: result.secure_url
            }
        });

    } catch (error) {
        console.error("Upload equipment media error:", error.message || error);

        return res.status(500).json({
            success: false,
            message: "Failed to upload media"
        });
    }
};


export const getEquipmentMedia = async (req, res) => {
    try {
        const { equipmentId } = req.params;
        const equipmentIdNumber = Number(equipmentId);

        if (!Number.isInteger(equipmentIdNumber) || equipmentIdNumber <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid equipment ID"
            });
        }

        const [equipment] = await pool.query(
            "SELECT id FROM equipment WHERE id = ?",
            [equipmentIdNumber]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        const [media] = await pool.query(
            `SELECT
                id,
                equipment_id,
                media_type,
                file_url,
                public_id,
                uploaded_by,
                created_at
            FROM equipment_media
            WHERE equipment_id = ?
            ORDER BY created_at DESC`,
            [equipmentId]
        );

        return res.status(200).json({
            success: true,
            message: "Equipment media fetched successfully",
            data: media
        });

    } catch (error) {
        console.error("Get equipment media error:", error.message || error);

        return res.status(500).json({
            success: false,
            message: "Failed to fetch equipment media"
        });
    }
};

export const deleteEquipmentMedia = async (req, res) => {
    try {
        const { equipmentId, mediaId } = req.params;
        const equipmentIdNum = Number(equipmentId);
        const mediaIdNum = Number(mediaId);

        if (!Number.isInteger(equipmentIdNum) || equipmentIdNum <= 0 || !Number.isInteger(mediaIdNum) || mediaIdNum <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid equipment ID or media ID"
            });
        }

        const [media] = await pool.query(
            `SELECT
                id,
                public_id,
                file_url,
                media_type
             FROM equipment_media
             WHERE id = ? AND equipment_id = ?`,
            [mediaIdNum, equipmentIdNum]
        );

        if (media.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Media not found for this equipment"
            });
        }

        const mediaData = media[0];

        // Delete from Cloudinary
        if (mediaData.public_id) {
            const resourceType =
                mediaData.media_type === "VIDEO" ? "video" : "image";

            await cloudinary.uploader.destroy(
                mediaData.public_id,
                {
                    resource_type: resourceType
                }
            );
        }

        // Delete from MySQL
        await pool.query(
            `DELETE FROM equipment_media
             WHERE id = ? AND equipment_id = ?`,
            [mediaIdNum, equipmentIdNum]
        );

        return res.status(200).json({
            success: true,
            message: "Media deleted successfully"
        });

    } catch (error) {
        console.error(
            "Delete equipment media error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to delete media"
        });
    }
};


export const getOwnerEquipmentMedia = async (req, res) => {
    try {
        const { ownerId } = req.params;

        const [owner] = await pool.query(
            `SELECT id
             FROM owners
             WHERE id = ?`,
            [ownerId]
        );

        if (owner.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Owner not found"
            });
        }

        const [media] = await pool.query(
            `SELECT
                em.id,
                em.equipment_id,
                e.name AS equipment_name,
                e.category_id,
                c.name AS category_name,
                em.media_type,
                em.file_url,
                em.public_id,
                em.created_at
             FROM equipment_media em
             JOIN equipment e
                 ON em.equipment_id = e.id
             JOIN equipment_categories c
                 ON e.category_id = c.id
             WHERE e.owner_id = ?
             ORDER BY em.created_at DESC`,
            [ownerId]
        );

        return res.status(200).json({
            success: true,
            message: "Owner equipment media fetched successfully",
            count: media.length,
            data: media
        });

    } catch (error) {
        console.error(
            "Get owner equipment media error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to fetch owner equipment media"
        });
    }
};