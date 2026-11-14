import pool from "../db.js";
import cloudinary from "../config/cloudinary.js";
import { sendEquipmentStatusEmail } from "../services/notificationService.js";
import { parsePositiveInt } from "../utils/responseHelper.js";

/**
 * Updates equipment status (e.g., AVAILABLE, BOOKED, MAINTENANCE, UNDER_INSPECTION, DAMAGED).
 * Access: OWNER (for their own equipment), AREA_ADMIN (in assigned area), SUPER_ADMIN.
 * Enforces business rule state machine validations.
 */
export const updateEquipmentStatus = async (req, res) => {
    try {
        const { equipmentId } = req.params;
        const { status } = req.body;

        const allowedStatuses = [
            "AVAILABLE",
            "BOOKED",
            "IN_USE",
            "MAINTENANCE",
            "DAMAGED",
            "UNDER_INSPECTION"
        ];

        if (!allowedStatuses.includes(status)) {
            return res.status(400).json({
                success: false,
                message: `Invalid equipment status. Allowed: ${allowedStatuses.join(", ")}`
            });
        }

        const [equipment] = await pool.query(
            `SELECT id, owner_id, location_id, status, verification_status
             FROM equipment
             WHERE id = ?`,
            [equipmentId]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        const eq = equipment[0];
        const user = req.user;

        // Role-based authorization & IDOR protection
        if (user.role === "OWNER") {
            const ownerId = user.owner_id;
            if (!ownerId || eq.owner_id !== ownerId) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to update status of equipment you do not own"
                });
            }
        } else if (user.role === "AREA_ADMIN") {
            if (!user.location_id || eq.location_id !== user.location_id) {
                return res.status(403).json({
                    success: false,
                    message: "Area Admin can only manage equipment within their assigned area"
                });
            }
        } else if (user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action"
            });
        }

        // State Machine Validations:
        // 1. Prevent moving to AVAILABLE if unverified
        if (status === "AVAILABLE" && eq.verification_status !== "VERIFIED") {
            return res.status(400).json({
                success: false,
                message: "Equipment cannot be set to AVAILABLE until it has been VERIFIED by an admin"
            });
        }

        // 2. Prevent moving directly from DAMAGED to AVAILABLE without maintenance/inspection
        if (eq.status === "DAMAGED" && status === "AVAILABLE") {
            return res.status(400).json({
                success: false,
                message: "Damaged equipment cannot be directly marked AVAILABLE. Please schedule MAINTENANCE or UNDER_INSPECTION first."
            });
        }

        // 3. Prevent manually changing status to BOOKED or IN_USE outside booking/inspection workflows
        if (status === "BOOKED" || status === "IN_USE") {
            const [activeBookings] = await pool.query(
                `SELECT id FROM bookings
                 WHERE equipment_id = ? AND status IN ('ACCEPTED', 'CONFIRMED', 'IN_PROGRESS')`,
                [equipmentId]
            );
            if (activeBookings.length === 0) {
                return res.status(400).json({
                    success: false,
                    message: `Equipment status can only be set to '${status}' through an active booking`
                });
            }
        }

        // 4. Prevent changing status to AVAILABLE if there is an active rental in progress
        if (status === "AVAILABLE") {
            const [inProgressBookings] = await pool.query(
                `SELECT id FROM bookings
                 WHERE equipment_id = ? AND status = 'IN_PROGRESS'`,
                [equipmentId]
            );
            if (inProgressBookings.length > 0) {
                return res.status(400).json({
                    success: false,
                    message: "Cannot mark equipment as AVAILABLE while an active rental is IN_PROGRESS"
                });
            }
        }

        await pool.query(
            `UPDATE equipment
             SET status = ?
             WHERE id = ?`,
            [status, equipmentId]
        );

        return res.status(200).json({
            success: true,
            message: "Equipment status updated successfully",
            data: {
                equipmentId: Number(equipmentId),
                previousStatus: eq.status,
                status
            }
        });

    } catch (error) {
        console.error("Update equipment status error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to update equipment status"
        });
    }
};

/**
 * Public route to get equipment details by ID with location and category info.
 */
export const getEquipmentById = async (req, res) => {
    try {
        const { equipmentId } = req.params;
        const eqId = parsePositiveInt(equipmentId);
        if (!eqId) {
            return res.status(400).json({ success: false, message: "Invalid equipment ID" });
        }

        const [equipment] = await pool.query(
            `SELECT
                e.id,
                e.name,
                e.equipment_type,
                e.category_id,
                c.name AS category_name,
                e.description,
                e.price_per_hour,
                e.price_per_day,
                e.status,
                e.verification_status,
                e.owner_id,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                ou.email AS owner_email,
                e.location_id,
                l.state,
                l.district,
                l.mandal,
                l.panchayat,
                l.village,
                e.verified_by,
                e.verified_at,
                e.created_at,
                e.updated_at
             FROM equipment e
             LEFT JOIN equipment_categories c ON e.category_id = c.id
             LEFT JOIN locations l ON e.location_id = l.id
             LEFT JOIN owners o ON e.owner_id = o.id
             LEFT JOIN users ou ON o.user_id = ou.id
             WHERE e.id = ?`,
            [eqId]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        // Fetch associated media
        const [media] = await pool.query(
            `SELECT id, media_type, file_url, public_id, created_at
             FROM equipment_media
             WHERE equipment_id = ?
             ORDER BY created_at DESC`,
            [eqId]
        );

        return res.status(200).json({
            success: true,
            message: "Equipment details fetched successfully",
            data: {
                ...equipment[0],
                media
            }
        });

    } catch (error) {
        console.error("Get equipment details error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch equipment details"
        });
    }
};

/**
 * Public route to list all verified available equipment.
 */
export const getAvailableEquipment = async (req, res) => {
    try {
        const [equipment] = await pool.query(
            `SELECT
                e.id,
                e.name,
                e.equipment_type,
                e.category_id,
                c.name AS category_name,
                e.description,
                e.price_per_hour,
                e.price_per_day,
                e.status,
                e.verification_status,
                e.owner_id,
                e.location_id,
                l.district,
                l.state,
                l.mandal,
                l.village,
                (SELECT file_url FROM equipment_media em WHERE em.equipment_id = e.id AND em.media_type = 'IMAGE' ORDER BY em.id ASC LIMIT 1) AS thumbnail_url
             FROM equipment e
             LEFT JOIN equipment_categories c ON e.category_id = c.id
             LEFT JOIN locations l ON e.location_id = l.id
             WHERE e.status = 'AVAILABLE'
               AND e.verification_status = 'VERIFIED'
             ORDER BY e.created_at DESC`
        );

        return res.status(200).json({
            success: true,
            message: "Available equipment fetched successfully",
            count: equipment.length,
            data: equipment
        });

    } catch (error) {
        console.error("Get available equipment error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch available equipment"
        });
    }
};

/**
 * Updates equipment verification status (VERIFIED or REJECTED).
 * Access: AREA_ADMIN (in assigned area only), SUPER_ADMIN.
 * verified_by is taken strictly from authenticated user (req.user.id).
 */
export const updateEquipmentVerification = async (req, res) => {
    try {
        const { equipmentId } = req.params;
        const { verification_status } = req.body;

        const allowedStatuses = ["VERIFIED", "REJECTED"];

        if (!allowedStatuses.includes(verification_status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid verification status. Must be VERIFIED or REJECTED"
            });
        }

        const [equipment] = await pool.query(
            `SELECT e.id, e.name, e.location_id, ou.email AS owner_email, ou.full_name AS owner_name
             FROM equipment e
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             WHERE e.id = ?`,
            [equipmentId]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        const eq = equipment[0];
        const user = req.user;

        // Area Admin scope validation
        if (user.role === "AREA_ADMIN") {
            if (!user.location_id || eq.location_id !== user.location_id) {
                return res.status(403).json({
                    success: false,
                    message: "Area Admin can only manage equipment within their assigned area"
                });
            }
        } else if (user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action"
            });
        }

        const verifiedBy = user.id;

        // If verified, set status to AVAILABLE; if rejected, keep UNDER_INSPECTION
        const newStatus = verification_status === "VERIFIED" ? "AVAILABLE" : "UNDER_INSPECTION";

        await pool.query(
            `UPDATE equipment
             SET
                verification_status = ?,
                status = ?,
                verified_by = ?,
                verified_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [
                verification_status,
                newStatus,
                verifiedBy,
                equipmentId
            ]
        );

        // Notify equipment owner via Brevo Email (non-blocking)
        if (eq.owner_email) {
            sendEquipmentStatusEmail({
                ownerEmail: eq.owner_email,
                ownerName: eq.owner_name,
                equipmentName: eq.name,
                status: newStatus,
                verificationStatus: verification_status,
                remarks: req.body.remarks || null
            }).catch(err => console.error("Equipment status email error:", err));
        }

        return res.status(200).json({
            success: true,
            message: `Equipment ${verification_status.toLowerCase()} successfully`,
            data: {
                equipmentId: Number(equipmentId),
                verificationStatus: verification_status,
                status: newStatus,
                verifiedBy: Number(verifiedBy)
            }
        });

    } catch (error) {
        console.error("Update equipment verification error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to update equipment verification"
        });
    }
};

/**
 * Creates new equipment.
 * Access: Authenticated OWNER only.
 * owner_id is taken strictly from authenticated owner profile (req.user.owner_id).
 * Enforces positive rental pricing and auto-populates equipment_type from category if omitted.
 */
export const createEquipment = async (req, res) => {
    try {
        const {
            location_id,
            name,
            category_id,
            equipment_type,
            description,
            price_per_hour,
            price_per_day
        } = req.body;

        // Strictly resolve owner_id from authenticated session
        let effectiveOwnerId = req.user.owner_id;
        if (!effectiveOwnerId) {
            const [ownerRows] = await pool.query(
                "SELECT id, location_id FROM owners WHERE user_id = ?",
                [req.user.id]
            );
            if (ownerRows.length === 0) {
                return res.status(403).json({
                    success: false,
                    message: "Owner profile not found for authenticated user"
                });
            }
            effectiveOwnerId = ownerRows[0].id;
        }

        const effectiveLocationId = location_id || req.user.location_id;

        if (!effectiveLocationId || !name || !category_id || price_per_day === undefined || price_per_day === null) {
            return res.status(400).json({
                success: false,
                message: "location_id, name, category_id, and price_per_day are required"
            });
        }

        const trimmedName = String(name).trim();
        if (trimmedName.length < 2 || trimmedName.length > 150) {
            return res.status(400).json({
                success: false,
                message: "Equipment name must be between 2 and 150 characters"
            });
        }

        const numPricePerDay = Number(price_per_day);
        if (isNaN(numPricePerDay) || numPricePerDay <= 0) {
            return res.status(400).json({
                success: false,
                message: "price_per_day must be a positive number greater than 0"
            });
        }

        let numPricePerHour = null;
        if (price_per_hour !== undefined && price_per_hour !== null && price_per_hour !== "") {
            numPricePerHour = Number(price_per_hour);
            if (isNaN(numPricePerHour) || numPricePerHour <= 0) {
                return res.status(400).json({
                    success: false,
                    message: "price_per_hour must be a positive number greater than 0"
                });
            }
        }

        const [location] = await pool.query(
            "SELECT id FROM locations WHERE id = ?",
            [effectiveLocationId]
        );

        if (location.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Location not found"
            });
        }

        const [category] = await pool.query(
            "SELECT id, name FROM equipment_categories WHERE id = ? AND status = 'ACTIVE'",
            [category_id]
        );

        if (category.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment category not found or inactive"
            });
        }

        // Auto-assign equipment_type from category name if omitted or empty
        const resolvedEquipmentType = (equipment_type && String(equipment_type).trim()) || category[0].name;

        const [result] = await pool.query(
            `INSERT INTO equipment (
                    owner_id,
                    location_id,
                    name,
                    category_id,
                    equipment_type,
                    description,
                    price_per_hour,
                    price_per_day,
                    status,
                    verification_status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'UNDER_INSPECTION', 'PENDING')`,
            [
                effectiveOwnerId,
                effectiveLocationId,
                trimmedName,
                category_id,
                resolvedEquipmentType,
                description ? String(description).trim() : null,
                numPricePerHour,
                numPricePerDay
            ]
        );

        return res.status(201).json({
            success: true,
            message: "Equipment created successfully",
            data: {
                equipmentId: result.insertId,
                ownerId: Number(effectiveOwnerId),
                locationId: Number(effectiveLocationId),
                name: trimmedName,
                categoryId: Number(category_id),
                equipmentType: resolvedEquipmentType,
                pricePerDay: numPricePerDay,
                pricePerHour: numPricePerHour,
                status: "UNDER_INSPECTION",
                verificationStatus: "PENDING"
            }
        });

    } catch (error) {
        console.error("Create equipment error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to create equipment"
        });
    }
};

/**
 * Updates equipment details.
 * Access: Authenticated equipment owner only.
 * Supports updating category_id, location_id, pricing, and descriptions with strict positive pricing.
 */
export const updateEquipment = async (req, res) => {
    try {
        const { equipmentId } = req.params;

        const {
            location_id,
            category_id,
            name,
            equipment_type,
            description,
            price_per_hour,
            price_per_day
        } = req.body;

        const [equipment] = await pool.query(
            "SELECT id, owner_id, category_id, equipment_type FROM equipment WHERE id = ?",
            [equipmentId]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        const eq = equipment[0];

        // Owner verification
        const ownerId = req.user.owner_id;
        if (!ownerId || eq.owner_id !== ownerId) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to update equipment you do not own"
            });
        }

        if (
            location_id === undefined &&
            category_id === undefined &&
            name === undefined &&
            equipment_type === undefined &&
            description === undefined &&
            price_per_hour === undefined &&
            price_per_day === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "At least one equipment field is required"
            });
        }

        const fields = [];
        const values = [];

        if (location_id !== undefined) {
            const locId = parsePositiveInt(location_id);
            if (!locId) {
                return res.status(400).json({ success: false, message: "Invalid location_id" });
            }
            const [location] = await pool.query("SELECT id FROM locations WHERE id = ?", [locId]);
            if (location.length === 0) {
                return res.status(404).json({ success: false, message: "Location not found" });
            }
            fields.push("location_id = ?");
            values.push(locId);
        }

        if (category_id !== undefined) {
            const catId = parsePositiveInt(category_id);
            if (!catId) {
                return res.status(400).json({ success: false, message: "Invalid category_id" });
            }
            const [catRows] = await pool.query("SELECT id, name FROM equipment_categories WHERE id = ? AND status = 'ACTIVE'", [catId]);
            if (catRows.length === 0) {
                return res.status(404).json({ success: false, message: "Equipment category not found or inactive" });
            }
            fields.push("category_id = ?");
            values.push(catId);
            if (equipment_type === undefined) {
                fields.push("equipment_type = ?");
                values.push(catRows[0].name);
            }
        }

        if (name !== undefined) {
            const trimmedName = String(name).trim();
            if (trimmedName.length < 2 || trimmedName.length > 150) {
                return res.status(400).json({ success: false, message: "Equipment name must be between 2 and 150 characters" });
            }
            fields.push("name = ?");
            values.push(trimmedName);
        }

        if (equipment_type !== undefined) {
            const trimmedType = String(equipment_type).trim();
            if (!trimmedType || trimmedType.length > 100) {
                return res.status(400).json({ success: false, message: "equipment_type must be between 1 and 100 characters" });
            }
            fields.push("equipment_type = ?");
            values.push(trimmedType);
        }

        if (description !== undefined) {
            fields.push("description = ?");
            values.push(description ? String(description).trim() : null);
        }

        if (price_per_day !== undefined) {
            const numDay = Number(price_per_day);
            if (isNaN(numDay) || numDay <= 0) {
                return res.status(400).json({ success: false, message: "price_per_day must be a positive number greater than 0" });
            }
            fields.push("price_per_day = ?");
            values.push(numDay);
        }

        if (price_per_hour !== undefined) {
            if (price_per_hour === null || price_per_hour === "") {
                fields.push("price_per_hour = ?");
                values.push(null);
            } else {
                const numHour = Number(price_per_hour);
                if (isNaN(numHour) || numHour <= 0) {
                    return res.status(400).json({ success: false, message: "price_per_hour must be a positive number greater than 0" });
                }
                fields.push("price_per_hour = ?");
                values.push(numHour);
            }
        }

        values.push(equipmentId);

        await pool.query(
            `UPDATE equipment
             SET ${fields.join(", ")}
             WHERE id = ?`,
            values
        );

        const [updatedEquipment] = await pool.query(
            `SELECT
                id,
                owner_id,
                location_id,
                name,
                category_id,
                equipment_type,
                description,
                price_per_hour,
                price_per_day,
                status,
                verification_status,
                verified_by,
                verified_at,
                created_at,
                updated_at
             FROM equipment
             WHERE id = ?`,
            [equipmentId]
        );

        return res.status(200).json({
            success: true,
            message: "Equipment updated successfully",
            data: updatedEquipment[0]
        });

    } catch (error) {
        console.error("Update equipment error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to update equipment"
        });
    }
};

/**
 * Deletes equipment with full Cloudinary media cleanup and dispute guards.
 * Access: Authenticated equipment owner only.
 */
export const deleteEquipment = async (req, res) => {
    try {
        const { equipmentId } = req.params;

        const [equipment] = await pool.query(
            `SELECT id, owner_id
             FROM equipment
             WHERE id = ?`,
            [equipmentId]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        const eq = equipment[0];

        // Owner verification
        const ownerId = req.user.owner_id;
        if (!ownerId || eq.owner_id !== ownerId) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to delete equipment you do not own"
            });
        }

        // Prevent deletion if there are active bookings
        const [activeBookings] = await pool.query(
            `SELECT id FROM bookings
             WHERE equipment_id = ?
             AND status IN ('PENDING', 'ACCEPTED', 'CONFIRMED', 'IN_PROGRESS')`,
            [equipmentId]
        );

        if (activeBookings.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete equipment with active or pending bookings"
            });
        }

        // Prevent deletion if there are active disputes
        const [activeDisputes] = await pool.query(
            `SELECT rd.id FROM refund_disputes rd
             JOIN bookings b ON rd.booking_id = b.id
             WHERE b.equipment_id = ?
               AND rd.status IN ('OPEN', 'UNDER_ADMIN_REVIEW', 'EVIDENCE_REQUESTED', 'ESCALATED_TO_SUPER_ADMIN')`,
            [equipmentId]
        );

        if (activeDisputes.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Cannot delete equipment associated with an active unresolved dispute"
            });
        }

        // 1. Fetch and destroy all associated media in Cloudinary
        const [mediaItems] = await pool.query(
            `SELECT id, public_id, media_type
             FROM equipment_media
             WHERE equipment_id = ?`,
            [equipmentId]
        );

        for (const item of mediaItems) {
            if (item.public_id) {
                const resourceType = item.media_type === "VIDEO" ? "video" : "image";
                await cloudinary.uploader.destroy(item.public_id, {
                    resource_type: resourceType
                }).catch(err => console.warn(`Cloudinary cleanup warning for ${item.public_id}:`, err.message));
            }
        }

        // 2. Delete equipment media rows
        await pool.query("DELETE FROM equipment_media WHERE equipment_id = ?", [equipmentId]);

        // 3. Delete equipment row
        await pool.query("DELETE FROM equipment WHERE id = ?", [equipmentId]);

        return res.status(200).json({
            success: true,
            message: "Equipment and associated media deleted successfully",
            data: {
                equipmentId: Number(equipmentId),
                deletedMediaCount: mediaItems.length
            }
        });

    } catch (error) {
        console.error("Delete equipment error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to delete equipment"
        });
    }
};

/**
 * Public search for verified available equipment with pagination, location joins, and thumbnails.
 * GET /api/equipment/search
 */
export const searchEquipment = async (req, res) => {
    try {
        const {
            category_id,
            equipment_type,
            location_id,
            state,
            district,
            min_price_per_day,
            max_price_per_day,
            name,
            page,
            limit
        } = req.query;

        let whereSql = `
            WHERE e.status = 'AVAILABLE'
              AND e.verification_status = 'VERIFIED'
        `;

        const values = [];

        if (category_id) {
            const catId = parsePositiveInt(category_id);
            if (catId) {
                whereSql += ` AND e.category_id = ?`;
                values.push(catId);
            }
        }

        if (equipment_type && equipment_type.trim()) {
            whereSql += ` AND LOWER(e.equipment_type) = LOWER(?)`;
            values.push(equipment_type.trim());
        }

        if (location_id) {
            const locId = parsePositiveInt(location_id);
            if (locId) {
                whereSql += ` AND e.location_id = ?`;
                values.push(locId);
            }
        }

        if (state && state.trim()) {
            whereSql += ` AND LOWER(l.state) = LOWER(?)`;
            values.push(state.trim());
        }

        if (district && district.trim()) {
            whereSql += ` AND LOWER(l.district) = LOWER(?)`;
            values.push(district.trim());
        }

        if (min_price_per_day !== undefined && min_price_per_day !== "") {
            const minP = Number(min_price_per_day);
            if (!isNaN(minP)) {
                whereSql += ` AND e.price_per_day >= ?`;
                values.push(minP);
            }
        }

        if (max_price_per_day !== undefined && max_price_per_day !== "") {
            const maxP = Number(max_price_per_day);
            if (!isNaN(maxP)) {
                whereSql += ` AND e.price_per_day <= ?`;
                values.push(maxP);
            }
        }

        if (name && name.trim()) {
            whereSql += ` AND e.name LIKE ?`;
            values.push(`%${name.trim()}%`);
        }

        const pageNum = Math.max(Number(page) || 1, 1);
        const limitNum = Math.min(Math.max(Number(limit) || 20, 1), 100);
        const offset = (pageNum - 1) * limitNum;

        // Total count query
        const [countRows] = await pool.query(
            `SELECT COUNT(*) AS total
             FROM equipment e
             LEFT JOIN locations l ON e.location_id = l.id
             ${whereSql}`,
            values
        );
        const total = countRows[0].total;

        // Data query with thumbnail subquery
        const [equipment] = await pool.query(
            `SELECT
                e.id,
                e.owner_id,
                e.location_id,
                e.name,
                e.category_id,
                c.name AS category_name,
                e.equipment_type,
                e.description,
                e.price_per_hour,
                e.price_per_day,
                e.status,
                e.verification_status,
                l.district,
                l.state,
                l.mandal,
                l.village,
                (SELECT file_url FROM equipment_media em WHERE em.equipment_id = e.id AND em.media_type = 'IMAGE' ORDER BY em.id ASC LIMIT 1) AS thumbnail_url
             FROM equipment e
             LEFT JOIN equipment_categories c ON e.category_id = c.id
             LEFT JOIN locations l ON e.location_id = l.id
             ${whereSql}
             ORDER BY e.created_at DESC
             LIMIT ? OFFSET ?`,
            [...values, limitNum, offset]
        );

        return res.status(200).json({
            success: true,
            message: "Equipment search completed successfully",
            count: equipment.length,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum) || 1
            },
            data: equipment
        });

    } catch (error) {
        console.error("Search equipment error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to search equipment"
        });
    }
};

/**
 * Gets equipment belonging to a specific owner.
 * Access: Owner (for their own equipment), Area Admin (within assigned area), Super Admin.
 */
export const getEquipmentByOwner = async (req, res) => {
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
                    message: "You are not authorized to view another owner's equipment"
                });
            }
        } else if (user.role === "AREA_ADMIN") {
            if (!user.location_id || (owner.location_id && owner.location_id !== user.location_id)) {
                return res.status(403).json({
                    success: false,
                    message: "Area Admin cannot view equipment for owners outside their assigned area"
                });
            }
        } else if (user.role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action"
            });
        }

        const [equipment] = await pool.query(
            `SELECT
                e.id,
                e.owner_id,
                e.location_id,
                e.name,
                e.category_id,
                c.name AS category_name,
                e.equipment_type,
                e.description,
                e.price_per_hour,
                e.price_per_day,
                e.status,
                e.verification_status,
                e.verified_by,
                e.verified_at,
                e.created_at,
                e.updated_at,
                (SELECT file_url FROM equipment_media em WHERE em.equipment_id = e.id AND em.media_type = 'IMAGE' ORDER BY em.id ASC LIMIT 1) AS thumbnail_url
             FROM equipment e
             LEFT JOIN equipment_categories c ON e.category_id = c.id
             WHERE e.owner_id = ?
             ORDER BY e.created_at DESC`,
            [ownerId]
        );

        return res.status(200).json({
            success: true,
            message: "Owner equipment fetched successfully",
            count: equipment.length,
            data: equipment
        });

    } catch (error) {
        console.error("Get owner equipment error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch owner equipment"
        });
    }
};

/**
 * Lists unverified equipment pending administrative review.
 * GET /api/equipment/admin/pending
 * Access: AREA_ADMIN (location-scoped), SUPER_ADMIN (platform-wide).
 */
export const getPendingVerificationEquipment = async (req, res) => {
    try {
        const { role, location_id } = req.user;

        let query = `
            SELECT
                e.id,
                e.name,
                e.category_id,
                c.name AS category_name,
                e.equipment_type,
                e.description,
                e.price_per_day,
                e.price_per_hour,
                e.status,
                e.verification_status,
                e.created_at,
                e.owner_id,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                ou.email AS owner_email,
                e.location_id,
                l.state,
                l.district,
                l.mandal,
                l.village
            FROM equipment e
            LEFT JOIN equipment_categories c ON e.category_id = c.id
            LEFT JOIN locations l ON e.location_id = l.id
            JOIN owners o ON e.owner_id = o.id
            JOIN users ou ON o.user_id = ou.id
            WHERE e.verification_status = 'PENDING'
        `;

        const values = [];

        if (role === "AREA_ADMIN") {
            if (!location_id) {
                return res.status(403).json({
                    success: false,
                    message: "Area Admin has no assigned location"
                });
            }
            query += " AND e.location_id = ?";
            values.push(location_id);
        }

        query += " ORDER BY e.created_at ASC";

        const [rows] = await pool.query(query, values);

        return res.status(200).json({
            success: true,
            message: "Pending verification equipment fetched successfully",
            count: rows.length,
            data: rows
        });

    } catch (error) {
        console.error("Get pending equipment error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to fetch pending equipment"
        });
    }
};

export default {
    updateEquipmentStatus,
    getEquipmentById,
    getAvailableEquipment,
    updateEquipmentVerification,
    createEquipment,
    updateEquipment,
    deleteEquipment,
    searchEquipment,
    getEquipmentByOwner,
    getPendingVerificationEquipment
};
