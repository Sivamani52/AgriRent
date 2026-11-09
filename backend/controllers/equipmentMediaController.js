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
 * Access: Authenticated equipment owner only.
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
        const [equipmentRows] = await pool.query(
            "SELECT id, owner_id FROM equipment WHERE id = ?",
            [equipmentIdNumber]
        );

        if (equipmentRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        const equipment = equipmentRows[0];

        // 3. Ownership Verification: Only the equipment owner can upload media
        const ownerId = req.user.owner_id;
        if (!ownerId || equipment.owner_id !== ownerId) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to upload media for equipment you do not own"
            });
        }

        // 4. Resolve uploaded_by strictly from authenticated user
        const uploadedBy = req.user.id;

        // 5. Detect media type from MIME type
        const isVideo = req.file.mimetype.startsWith("video/");
        const mediaType = isVideo ? "VIDEO" : "IMAGE";
        const resourceType = isVideo ? "video" : "image";

        // 6. Upload file buffer to Cloudinary
        const result = await uploadToCloudinary(req.file.buffer, resourceType);

        // 7. Store Cloudinary secure_url in MySQL equipment_media table
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

/**
 * Public route to get all media for an equipment.
 */
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

/**
 * Delete equipment media.
 * Access: Owner of equipment, Area Admin (within assigned area), Super Admin.
 */
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

        const [mediaRows] = await pool.query(
            `SELECT
                em.id,
                em.public_id,
                em.file_url,
                em.media_type,
                e.owner_id,
                e.location_id
             FROM equipment_media em
             JOIN equipment e ON em.equipment_id = e.id
             WHERE em.id = ? AND em.equipment_id = ?`,
            [mediaIdNum, equipmentIdNum]
        );

        if (mediaRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Media not found for this equipment"
            });
        }

        const mediaData = mediaRows[0];
        const user = req.user;

        // Role-based Access and Ownership Check
        if (user.role === "OWNER") {
            if (!user.owner_id || mediaData.owner_id !== user.owner_id) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to delete media for equipment you do not own"
                });
            }
        } else if (user.role === "AREA_ADMIN") {
            if (!user.location_id || mediaData.location_id !== user.location_id) {
                return res.status(403).json({
                    success: false,
                    message: "Area Admin can only manage media within their assigned area"
                });
            }
        } else if (user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action"
            });
        }

        // Delete from Cloudinary if public_id exists
        if (mediaData.public_id) {
            const resourceType =
                mediaData.media_type === "VIDEO" ? "video" : "image";

            await cloudinary.uploader.destroy(
                mediaData.public_id,
                {
                    resource_type: resourceType
                }
            ).catch(err => {
                console.warn("Cloudinary delete warning:", err.message || err);
            });
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

/**
 * Gets media for all equipment belonging to an owner.
 * Access: Owner themselves, Area Admin (within assigned area), Super Admin.
 * Protects against owners accessing other owners' private media management.
 */
export const getOwnerEquipmentMedia = async (req, res) => {
    try {
        const { ownerId } = req.params;

        const [ownerRows] = await pool.query(
            `SELECT id, user_id, location_id
             FROM owners
             WHERE id = ?`,
            [ownerId]
        );

        if (ownerRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Owner not found"
            });
        }

        const owner = ownerRows[0];
        const user = req.user;

        // Role-based Access and Ownership Check
        if (user.role === "OWNER") {
            if (owner.user_id !== user.id) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to view another owner's private media management"
                });
            }
        } else if (user.role === "AREA_ADMIN") {
            if (!user.location_id || (owner.location_id && owner.location_id !== user.location_id)) {
                return res.status(403).json({
                    success: false,
                    message: "Area Admin cannot view media for owners outside their assigned area"
                });
            }
        } else if (user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action"
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
