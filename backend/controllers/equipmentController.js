import pool from "../db.js";
import { sendEquipmentStatusEmail } from "../services/notificationService.js";

/**
 * Updates equipment status (e.g., AVAILABLE, BOOKED, MAINTENANCE, UNDER_INSPECTION).
 * Access: OWNER (for their own equipment), AREA_ADMIN (in assigned area), SUPER_ADMIN.
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
                message: "Invalid equipment status"
            });
        }

        const [equipment] = await pool.query(
            "SELECT id, owner_id, location_id FROM equipment WHERE id = ?",
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
                status
            }
        });

    } catch (error) {
        console.error(
            "Update equipment status error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to update equipment status"
        });
    }
};

/**
 * Public route to get equipment details by ID.
 */
export const getEquipmentById = async (req, res) => {
    try {
        const { equipmentId } = req.params;

        const [equipment] = await pool.query(
            `SELECT
                e.id,
                e.name,
                e.equipment_type,
                e.description,
                e.price_per_hour,
                e.price_per_day,
                e.status,
                e.verification_status,
                e.owner_id,
                e.location_id,
                e.verified_by,
                e.verified_at,
                e.created_at,
                e.updated_at
             FROM equipment e
             WHERE e.id = ?`,
            [equipmentId]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Equipment details fetched successfully",
            data: equipment[0]
        });

    } catch (error) {
        console.error(
            "Get equipment details error:",
            error.message || error
        );

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
                id,
                name,
                equipment_type,
                description,
                price_per_hour,
                price_per_day,
                status,
                verification_status,
                owner_id,
                location_id
             FROM equipment
             WHERE status = 'AVAILABLE'
             AND verification_status = 'VERIFIED'
             ORDER BY created_at DESC`
        );

        return res.status(200).json({
            success: true,
            message: "Available equipment fetched successfully",
            count: equipment.length,
            data: equipment
        });

    } catch (error) {
        console.error(
            "Get available equipment error:",
            error.message || error
        );

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

        const allowedStatuses = [
            "VERIFIED",
            "REJECTED"
        ];

        if (!allowedStatuses.includes(verification_status)) {
            return res.status(400).json({
                success: false,
                message: "Invalid verification status"
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

        // Never trust verified_by from req.body; strictly use authenticated user's ID
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
        console.error(
            "Update equipment verification error:",
            error.message || error
        );

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

        if (!effectiveLocationId || !name || !category_id) {
            return res.status(400).json({
                success: false,
                message: "location_id, name and category_id are required"
            });
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
            "SELECT id FROM equipment_categories WHERE id = ? AND status = 'ACTIVE'",
            [category_id]
        );

        if (category.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment category not found or inactive"
            });
        }

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
                name,
                category_id,
                equipment_type || null,
                description || null,
                price_per_hour || null,
                price_per_day || null
            ]
        );

        return res.status(201).json({
            success: true,
            message: "Equipment created successfully",
            data: {
                equipmentId: result.insertId,
                ownerId: Number(effectiveOwnerId),
                locationId: Number(effectiveLocationId),
                name,
                equipmentType: equipment_type,
                status: "UNDER_INSPECTION",
                verificationStatus: "PENDING"
            }
        });

    } catch (error) {
        console.error(
            "Create equipment error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to create equipment"
        });
    }
};

/**
 * Updates equipment details.
 * Access: Authenticated equipment owner only.
 */
export const updateEquipment = async (req, res) => {
    try {
        const { equipmentId } = req.params;

        const {
            location_id,
            name,
            equipment_type,
            description,
            price_per_hour,
            price_per_day
        } = req.body;

        const [equipment] = await pool.query(
            "SELECT id, owner_id FROM equipment WHERE id = ?",
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
            !location_id &&
            !name &&
            !equipment_type &&
            description === undefined &&
            price_per_hour === undefined &&
            price_per_day === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "At least one equipment field is required"
            });
        }

        if (location_id) {
            const [location] = await pool.query(
                "SELECT id FROM locations WHERE id = ?",
                [location_id]
            );

            if (location.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Location not found"
                });
            }
        }

        const fields = [];
        const values = [];

        if (location_id !== undefined) {
            fields.push("location_id = ?");
            values.push(location_id);
        }

        if (name !== undefined) {
            fields.push("name = ?");
            values.push(name);
        }

        if (equipment_type !== undefined) {
            fields.push("equipment_type = ?");
            values.push(equipment_type);
        }

        if (description !== undefined) {
            fields.push("description = ?");
            values.push(description);
        }

        if (price_per_hour !== undefined) {
            fields.push("price_per_hour = ?");
            values.push(price_per_hour);
        }

        if (price_per_day !== undefined) {
            fields.push("price_per_day = ?");
            values.push(price_per_day);
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
        console.error(
            "Update equipment error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to update equipment"
        });
    }
};

/**
 * Deletes equipment.
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

        await pool.query(
            `DELETE FROM equipment
             WHERE id = ?`,
            [equipmentId]
        );

        return res.status(200).json({
            success: true,
            message: "Equipment deleted successfully",
            data: {
                equipmentId: Number(equipmentId)
            }
        });

    } catch (error) {
        console.error(
            "Delete equipment error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to delete equipment"
        });
    }
};

/**
 * Public search for verified available equipment.
 */
export const searchEquipment = async (req, res) => {
    try {
       const {
            category_id,
            equipment_type,
            location_id,
            min_price_per_day,
            max_price_per_day,
            name
        } = req.query;

        let query = `
            SELECT
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
                e.verification_status
            FROM equipment e
            JOIN equipment_categories c
                ON e.category_id = c.id
            WHERE e.status = 'AVAILABLE'
            AND e.verification_status = 'VERIFIED'
        `;

        const values = [];

        if (category_id) {
            query += ` AND e.category_id = ?`;
            values.push(category_id);
        }

        if (equipment_type) {
            query += ` AND e.equipment_type = ?`;
            values.push(equipment_type);
        }

        if (location_id) {
            query += ` AND e.location_id = ?`;
            values.push(location_id);
        }

        if (min_price_per_day !== undefined) {
            query += ` AND e.price_per_day >= ?`;
            values.push(min_price_per_day);
        }

        if (max_price_per_day !== undefined) {
            query += ` AND e.price_per_day <= ?`;
            values.push(max_price_per_day);
        }

        if (name) {
            query += ` AND e.name LIKE ?`;
            values.push(`%${name}%`);
        }

        query += ` ORDER BY e.created_at DESC`;

        const [equipment] = await pool.query(query, values);

        return res.status(200).json({
            success: true,
            message: "Equipment search completed successfully",
            count: equipment.length,
            data: equipment
        });

    } catch (error) {
        console.error(
            "Search equipment error:",
            error.message || error
        );

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
                e.updated_at
             FROM equipment e
             JOIN equipment_categories c
                 ON e.category_id = c.id
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
        console.error(
            "Get owner equipment error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to fetch owner equipment"
        });
    }
};
