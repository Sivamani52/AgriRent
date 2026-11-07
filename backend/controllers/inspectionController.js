import pool from "../db.js";
import cloudinary from "../config/cloudinary.js";
import {
    sendInspectionSubmittedSMS,
    sendHandoverCompletedSMS,
    sendReturnCompletedSMS,
    sendReturnDamageDisputeSMS
} from "../services/smsService.js";

/**
 * Uploads a file buffer directly to Cloudinary
 * @param {Buffer} fileBuffer
 * @param {string} resourceType - "image" | "video"
 * @param {string} folder - Cloudinary folder path
 * @returns {Promise<object>}
 */
const uploadBufferToCloudinary = (fileBuffer, resourceType, folder = "agrirent/inspections") => {
    return new Promise((resolve, reject) => {
        const stream = cloudinary.uploader.upload_stream(
            {
                folder,
                resource_type: resourceType
            },
            (error, result) => {
                if (error) return reject(error);
                resolve(result);
            }
        );
        stream.end(fileBuffer);
    });
};

/**
 * Validates requester role and access to the given booking.
 * Returns booking details or throws structured HTTP error.
 */
const getAuthorizedBooking = async (bookingId, user) => {
    const [bookings] = await pool.query(
        `SELECT
            b.id AS booking_id,
            b.equipment_id,
            b.farmer_id,
            b.status AS booking_status,
            b.total_amount,
            b.advance_amount,
            e.name AS equipment_name,
            e.status AS equipment_status,
            e.owner_id,
            e.location_id AS equipment_location_id,
            o.user_id AS owner_user_id,
            ou.full_name AS owner_name,
            ou.phone AS owner_phone,
            f.user_id AS farmer_user_id,
            fu.full_name AS farmer_name,
            fu.phone AS farmer_phone
         FROM bookings b
         JOIN equipment e ON b.equipment_id = e.id
         JOIN owners o ON e.owner_id = o.id
         JOIN users ou ON o.user_id = ou.id
         JOIN farmers f ON b.farmer_id = f.id
         JOIN users fu ON f.user_id = fu.id
         WHERE b.id = ?`,
        [bookingId]
    );

    if (bookings.length === 0) {
        const error = new Error("Booking not found");
        error.statusCode = 404;
        throw error;
    }

    const booking = bookings[0];

    // Authorization & IDOR verification
    if (user.role === "OWNER") {
        if (booking.owner_user_id !== user.id) {
            const error = new Error("You are not authorized to access inspections for this booking");
            error.statusCode = 403;
            throw error;
        }
    } else if (user.role === "FARMER") {
        if (booking.farmer_user_id !== user.id) {
            const error = new Error("You are not authorized to access inspections for this booking");
            error.statusCode = 403;
            throw error;
        }
    } else if (user.role === "AREA_ADMIN") {
        if (!user.location_id || booking.equipment_location_id !== user.location_id) {
            const error = new Error("Area Admin can only access bookings within their assigned area");
            error.statusCode = 403;
            throw error;
        }
    } else if (user.role !== "SUPER_ADMIN") {
        const error = new Error("Unauthorized access");
        error.statusCode = 403;
        throw error;
    }

    return booking;
};

// =========================================================================
// STAGE 1: INITIAL INSPECTION (Pre-Handover)
// =========================================================================

/**
 * Submit or update Stage 1 Initial Inspection.
 * Access: Booking's OWNER or FARMER.
 * Allowed when booking is in 'CONFIRMED' status.
 */
export const submitInitialInspection = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await getAuthorizedBooking(bookingId, req.user);

        if (booking.booking_status !== "CONFIRMED") {
            return res.status(400).json({
                success: false,
                message: `Initial inspection can only be conducted for confirmed bookings awaiting handover. Current status: ${booking.booking_status}`
            });
        }

        const role = req.user.role;
        if (role !== "OWNER" && role !== "FARMER") {
            return res.status(403).json({
                success: false,
                message: "Only the equipment owner or farmer can submit inspection records"
            });
        }

        // Check if an inspection was already confirmed by this party
        const [existing] = await pool.query(
            `SELECT id, is_confirmed
             FROM equipment_inspections
             WHERE booking_id = ? AND inspection_stage = 'INITIAL' AND inspector_role = ?`,
            [bookingId, role]
        );

        if (existing.length > 0 && existing[0].is_confirmed) {
            return res.status(400).json({
                success: false,
                message: "Initial inspection has already been confirmed and cannot be modified"
            });
        }

        const {
            engine_condition,
            tyres_condition,
            body_condition,
            fuel_level,
            odometer_hours,
            checklist_notes,
            is_damage_reported,
            damage_description
        } = req.body;

        const validConditions = ["EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"];
        if (
            !validConditions.includes(engine_condition) ||
            !validConditions.includes(tyres_condition) ||
            !validConditions.includes(body_condition) ||
            !fuel_level
        ) {
            return res.status(400).json({
                success: false,
                message: "engine_condition, tyres_condition, body_condition, and fuel_level are required valid fields"
            });
        }

        let inspectionId;

        if (existing.length > 0) {
            inspectionId = existing[0].id;
            await pool.query(
                `UPDATE equipment_inspections
                 SET engine_condition = ?,
                     tyres_condition = ?,
                     body_condition = ?,
                     fuel_level = ?,
                     odometer_hours = ?,
                     checklist_notes = ?,
                     is_damage_reported = ?,
                     damage_description = ?
                 WHERE id = ?`,
                [
                    engine_condition,
                    tyres_condition,
                    body_condition,
                    fuel_level,
                    odometer_hours || null,
                    checklist_notes || null,
                    Boolean(is_damage_reported === "true" || is_damage_reported === true),
                    damage_description || null,
                    inspectionId
                ]
            );
        } else {
            const [insertResult] = await pool.query(
                `INSERT INTO equipment_inspections (
                    booking_id,
                    equipment_id,
                    inspection_stage,
                    inspector_role,
                    inspector_user_id,
                    engine_condition,
                    tyres_condition,
                    body_condition,
                    fuel_level,
                    odometer_hours,
                    checklist_notes,
                    is_damage_reported,
                    damage_description,
                    is_confirmed
                ) VALUES (?, ?, 'INITIAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
                [
                    bookingId,
                    booking.equipment_id,
                    role,
                    req.user.id,
                    engine_condition,
                    tyres_condition,
                    body_condition,
                    fuel_level,
                    odometer_hours || null,
                    checklist_notes || null,
                    Boolean(is_damage_reported === "true" || is_damage_reported === true),
                    damage_description || null
                ]
            );
            inspectionId = insertResult.insertId;
        }

        // Process media uploads if provided
        const uploadedMedia = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const isVideo = file.mimetype.startsWith("video/");
                const mediaType = isVideo ? "VIDEO" : "IMAGE";
                const resourceType = isVideo ? "video" : "image";

                const uploadRes = await uploadBufferToCloudinary(file.buffer, resourceType, "agrirent/inspections/initial");

                const [mediaInsert] = await pool.query(
                    `INSERT INTO inspection_media (
                        inspection_id,
                        booking_id,
                        media_type,
                        file_url,
                        public_id,
                        uploaded_by_user_id
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        inspectionId,
                        bookingId,
                        mediaType,
                        uploadRes.secure_url,
                        uploadRes.public_id,
                        req.user.id
                    ]
                );

                uploadedMedia.push({
                    id: mediaInsert.insertId,
                    mediaType,
                    fileUrl: uploadRes.secure_url
                });
            }
        }

        // Notify counterpart via SMS (non-blocking)
        const recipientPhone = role === "OWNER" ? booking.farmer_phone : booking.owner_phone;
        const recipientName = role === "OWNER" ? booking.farmer_name : booking.owner_name;
        sendInspectionSubmittedSMS({
            recipientPhone,
            recipientName,
            bookingId,
            stage: "INITIAL",
            inspectorRole: role
        }).catch(err => console.error("Inspection submitted SMS error:", err));

        return res.status(200).json({
            success: true,
            message: "Initial inspection recorded successfully. Please confirm to finalize handover.",
            data: {
                inspectionId,
                bookingId: Number(bookingId),
                stage: "INITIAL",
                role,
                engineCondition: engine_condition,
                tyresCondition: tyres_condition,
                bodyCondition: body_condition,
                fuelLevel: fuel_level,
                odometerHours: odometer_hours,
                isConfirmed: false,
                mediaCount: uploadedMedia.length,
                media: uploadedMedia
            }
        });

    } catch (error) {
        console.error("Submit initial inspection error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to submit initial inspection"
        });
    }
};

/**
 * Confirm Stage 1 Initial Inspection.
 * When BOTH Owner and Farmer confirm, the booking transitions to 'IN_PROGRESS'
 * and the equipment transitions to 'IN_USE'.
 */
export const confirmInitialInspection = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { bookingId } = req.params;
        const role = req.user.role;

        if (role !== "OWNER" && role !== "FARMER") {
            return res.status(403).json({
                success: false,
                message: "Only the equipment owner or farmer can confirm inspection"
            });
        }

        await connection.beginTransaction();

        // 1. Lock and verify booking
        const [bookings] = await connection.query(
            `SELECT
                b.id AS booking_id,
                b.equipment_id,
                b.status AS booking_status,
                e.name AS equipment_name,
                o.user_id AS owner_user_id,
                ou.phone AS owner_phone,
                ou.full_name AS owner_name,
                f.user_id AS farmer_user_id,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE b.id = ?
             FOR UPDATE`,
            [bookingId]
        );

        if (bookings.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        const booking = bookings[0];

        // Authorization check
        if (role === "OWNER" && booking.owner_user_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: "Unauthorized: You do not own this equipment" });
        }
        if (role === "FARMER" && booking.farmer_user_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: "Unauthorized: You are not the booking farmer" });
        }

        if (booking.booking_status !== "CONFIRMED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `Initial inspection can only be confirmed on confirmed bookings awaiting handover. Current status: ${booking.booking_status}`
            });
        }

        // 2. Lock current party's inspection record
        const [myInspection] = await connection.query(
            `SELECT id, is_confirmed
             FROM equipment_inspections
             WHERE booking_id = ? AND inspection_stage = 'INITIAL' AND inspector_role = ?
             FOR UPDATE`,
            [bookingId, role]
        );

        if (myInspection.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "You must record the initial inspection details before confirming"
            });
        }

        if (myInspection[0].is_confirmed) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "You have already confirmed this initial inspection"
            });
        }

        // Mark confirmed
        await connection.query(
            `UPDATE equipment_inspections
             SET is_confirmed = TRUE,
                 confirmed_at = NOW()
             WHERE id = ?`,
            [myInspection[0].id]
        );

        // 3. Check if both parties have confirmed Stage 1
        const [confirmedInspections] = await connection.query(
            `SELECT inspector_role, is_confirmed
             FROM equipment_inspections
             WHERE booking_id = ? AND inspection_stage = 'INITIAL' AND is_confirmed = TRUE
             FOR UPDATE`,
            [bookingId]
        );

        let handoverFinalized = false;

        // If both OWNER and FARMER have confirmed Stage 1:
        if (confirmedInspections.length >= 2) {
            // Update booking to IN_PROGRESS
            await connection.query(
                `UPDATE bookings
                 SET status = 'IN_PROGRESS',
                     handover_completed_at = NOW()
                 WHERE id = ?`,
                [bookingId]
            );

            // Update equipment to IN_USE
            await connection.query(
                `UPDATE equipment
                 SET status = 'IN_USE'
                 WHERE id = ?`,
                [booking.equipment_id]
            );

            handoverFinalized = true;
        }

        await connection.commit();

        // 4. Send Handover notifications if finalized
        if (handoverFinalized) {
            sendHandoverCompletedSMS({
                recipientPhone: booking.owner_phone,
                recipientName: booking.owner_name,
                bookingId,
                equipmentName: booking.equipment_name
            }).catch(err => console.error("Handover SMS error:", err));

            sendHandoverCompletedSMS({
                recipientPhone: booking.farmer_phone,
                recipientName: booking.farmer_name,
                bookingId,
                equipmentName: booking.equipment_name
            }).catch(err => console.error("Handover SMS error:", err));
        }

        return res.status(200).json({
            success: true,
            message: handoverFinalized
                ? "Initial inspection confirmed by both parties. Handover completed and rental is now ACTIVE."
                : "Initial inspection confirmed successfully. Awaiting counterpart confirmation to finalize handover.",
            data: {
                bookingId: Number(bookingId),
                role,
                isConfirmed: true,
                handoverFinalized,
                bookingStatus: handoverFinalized ? "IN_PROGRESS" : "CONFIRMED",
                equipmentStatus: handoverFinalized ? "IN_USE" : "BOOKED"
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Confirm initial inspection error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to confirm initial inspection"
        });
    } finally {
        connection.release();
    }
};

/**
 * Get Stage 1 Initial Inspection records and comparison.
 */
export const getInitialInspection = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await getAuthorizedBooking(bookingId, req.user);

        const [inspections] = await pool.query(
            `SELECT
                ei.*,
                u.full_name AS inspector_name,
                u.phone AS inspector_phone
             FROM equipment_inspections ei
             JOIN users u ON ei.inspector_user_id = u.id
             WHERE ei.booking_id = ? AND ei.inspection_stage = 'INITIAL'
             ORDER BY ei.created_at ASC`,
            [bookingId]
        );

        // Fetch media for each inspection
        for (const insp of inspections) {
            const [media] = await pool.query(
                `SELECT id, media_type, file_url, public_id, created_at
                 FROM inspection_media
                 WHERE inspection_id = ?`,
                [insp.id]
            );
            insp.media = media;
        }

        const ownerInspection = inspections.find(i => i.inspector_role === "OWNER") || null;
        const farmerInspection = inspections.find(i => i.inspector_role === "FARMER") || null;
        const isHandoverReady = ownerInspection?.is_confirmed && farmerInspection?.is_confirmed;

        return res.status(200).json({
            success: true,
            data: {
                bookingId: Number(bookingId),
                equipmentId: booking.equipment_id,
                equipmentName: booking.equipment_name,
                bookingStatus: booking.booking_status,
                isHandoverReady: Boolean(isHandoverReady),
                handoverCompletedAt: booking.handover_completed_at,
                ownerInspection,
                farmerInspection
            }
        });

    } catch (error) {
        console.error("Get initial inspection error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch initial inspection"
        });
    }
};

// =========================================================================
// STAGE 2: FINAL INSPECTION (Post-Rental Return)
// =========================================================================

/**
 * Submit or update Stage 2 Final Return Inspection.
 * Access: Booking's OWNER or FARMER.
 * Allowed when booking is in 'IN_PROGRESS' status.
 */
export const submitFinalInspection = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await getAuthorizedBooking(bookingId, req.user);

        if (booking.booking_status !== "IN_PROGRESS") {
            return res.status(400).json({
                success: false,
                message: `Final return inspection can only be conducted for active rentals. Current status: ${booking.booking_status}`
            });
        }

        const role = req.user.role;
        if (role !== "OWNER" && role !== "FARMER") {
            return res.status(403).json({
                success: false,
                message: "Only the equipment owner or farmer can submit inspection records"
            });
        }

        // Check if inspection was already confirmed
        const [existing] = await pool.query(
            `SELECT id, is_confirmed
             FROM equipment_inspections
             WHERE booking_id = ? AND inspection_stage = 'FINAL' AND inspector_role = ?`,
            [bookingId, role]
        );

        if (existing.length > 0 && existing[0].is_confirmed) {
            return res.status(400).json({
                success: false,
                message: "Final return inspection has already been confirmed and cannot be modified"
            });
        }

        const {
            engine_condition,
            tyres_condition,
            body_condition,
            fuel_level,
            odometer_hours,
            checklist_notes,
            is_damage_reported,
            damage_description,
            estimated_damage_cost
        } = req.body;

        const validConditions = ["EXCELLENT", "GOOD", "FAIR", "POOR", "DAMAGED"];
        if (
            !validConditions.includes(engine_condition) ||
            !validConditions.includes(tyres_condition) ||
            !validConditions.includes(body_condition) ||
            !fuel_level
        ) {
            return res.status(400).json({
                success: false,
                message: "engine_condition, tyres_condition, body_condition, and fuel_level are required valid fields"
            });
        }

        let inspectionId;

        if (existing.length > 0) {
            inspectionId = existing[0].id;
            await pool.query(
                `UPDATE equipment_inspections
                 SET engine_condition = ?,
                     tyres_condition = ?,
                     body_condition = ?,
                     fuel_level = ?,
                     odometer_hours = ?,
                     checklist_notes = ?,
                     is_damage_reported = ?,
                     damage_description = ?,
                     estimated_damage_cost = ?
                 WHERE id = ?`,
                [
                    engine_condition,
                    tyres_condition,
                    body_condition,
                    fuel_level,
                    odometer_hours || null,
                    checklist_notes || null,
                    Boolean(is_damage_reported === "true" || is_damage_reported === true),
                    damage_description || null,
                    Number(estimated_damage_cost) || 0.00,
                    inspectionId
                ]
            );
        } else {
            const [insertResult] = await pool.query(
                `INSERT INTO equipment_inspections (
                    booking_id,
                    equipment_id,
                    inspection_stage,
                    inspector_role,
                    inspector_user_id,
                    engine_condition,
                    tyres_condition,
                    body_condition,
                    fuel_level,
                    odometer_hours,
                    checklist_notes,
                    is_damage_reported,
                    damage_description,
                    estimated_damage_cost,
                    is_confirmed
                ) VALUES (?, ?, 'FINAL', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, FALSE)`,
                [
                    bookingId,
                    booking.equipment_id,
                    role,
                    req.user.id,
                    engine_condition,
                    tyres_condition,
                    body_condition,
                    fuel_level,
                    odometer_hours || null,
                    checklist_notes || null,
                    Boolean(is_damage_reported === "true" || is_damage_reported === true),
                    damage_description || null,
                    Number(estimated_damage_cost) || 0.00
                ]
            );
            inspectionId = insertResult.insertId;
        }

        // Process media uploads if provided
        const uploadedMedia = [];
        if (req.files && req.files.length > 0) {
            for (const file of req.files) {
                const isVideo = file.mimetype.startsWith("video/");
                const mediaType = isVideo ? "VIDEO" : "IMAGE";
                const resourceType = isVideo ? "video" : "image";

                const uploadRes = await uploadBufferToCloudinary(file.buffer, resourceType, "agrirent/inspections/final");

                const [mediaInsert] = await pool.query(
                    `INSERT INTO inspection_media (
                        inspection_id,
                        booking_id,
                        media_type,
                        file_url,
                        public_id,
                        uploaded_by_user_id
                    ) VALUES (?, ?, ?, ?, ?, ?)`,
                    [
                        inspectionId,
                        bookingId,
                        mediaType,
                        uploadRes.secure_url,
                        uploadRes.public_id,
                        req.user.id
                    ]
                );

                uploadedMedia.push({
                    id: mediaInsert.insertId,
                    mediaType,
                    fileUrl: uploadRes.secure_url
                });
            }
        }

        // Notify counterpart via SMS
        const recipientPhone = role === "OWNER" ? booking.farmer_phone : booking.owner_phone;
        const recipientName = role === "OWNER" ? booking.farmer_name : booking.owner_name;
        sendInspectionSubmittedSMS({
            recipientPhone,
            recipientName,
            bookingId,
            stage: "FINAL",
            inspectorRole: role
        }).catch(err => console.error("Final inspection SMS error:", err));

        return res.status(200).json({
            success: true,
            message: "Final return inspection recorded successfully. Please confirm to finalize return.",
            data: {
                inspectionId,
                bookingId: Number(bookingId),
                stage: "FINAL",
                role,
                engineCondition: engine_condition,
                tyresCondition: tyres_condition,
                bodyCondition: body_condition,
                fuelLevel: fuel_level,
                odometerHours: odometer_hours,
                isDamageReported: Boolean(is_damage_reported === "true" || is_damage_reported === true),
                damageDescription: damage_description,
                isConfirmed: false,
                mediaCount: uploadedMedia.length,
                media: uploadedMedia
            }
        });

    } catch (error) {
        console.error("Submit final inspection error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to submit final inspection"
        });
    }
};

/**
 * Confirm Stage 2 Final Return Inspection.
 * When BOTH confirm:
 * - If NO damage: booking -> COMPLETED, equipment -> AVAILABLE (if no conflicting bookings).
 * - If damage IS reported: booking -> DISPUTED / under penalty, equipment -> DAMAGED.
 */
export const confirmFinalInspection = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { bookingId } = req.params;
        const role = req.user.role;

        if (role !== "OWNER" && role !== "FARMER") {
            return res.status(403).json({
                success: false,
                message: "Only the equipment owner or farmer can confirm return inspection"
            });
        }

        await connection.beginTransaction();

        // 1. Lock and verify booking
        const [bookings] = await connection.query(
            `SELECT
                b.id AS booking_id,
                b.equipment_id,
                b.status AS booking_status,
                e.name AS equipment_name,
                e.location_id,
                o.user_id AS owner_user_id,
                ou.phone AS owner_phone,
                ou.full_name AS owner_name,
                f.user_id AS farmer_user_id,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE b.id = ?
             FOR UPDATE`,
            [bookingId]
        );

        if (bookings.length === 0) {
            await connection.rollback();
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        const booking = bookings[0];

        // Authorization check
        if (role === "OWNER" && booking.owner_user_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: "Unauthorized: You do not own this equipment" });
        }
        if (role === "FARMER" && booking.farmer_user_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({ success: false, message: "Unauthorized: You are not the booking farmer" });
        }

        if (booking.booking_status !== "IN_PROGRESS") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `Final return inspection can only be confirmed for active rentals. Current status: ${booking.booking_status}`
            });
        }

        // 2. Lock current party's inspection record
        const [myInspection] = await connection.query(
            `SELECT id, is_confirmed
             FROM equipment_inspections
             WHERE booking_id = ? AND inspection_stage = 'FINAL' AND inspector_role = ?
             FOR UPDATE`,
            [bookingId, role]
        );

        if (myInspection.length === 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "You must record the final return inspection details before confirming"
            });
        }

        if (myInspection[0].is_confirmed) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "You have already confirmed this return inspection"
            });
        }

        // Mark confirmed
        await connection.query(
            `UPDATE equipment_inspections
             SET is_confirmed = TRUE,
                 confirmed_at = NOW()
             WHERE id = ?`,
            [myInspection[0].id]
        );

        // 3. Check if both parties have confirmed Stage 2
        const [confirmedInspections] = await connection.query(
            `SELECT
                inspector_role,
                is_damage_reported,
                damage_description,
                estimated_damage_cost
             FROM equipment_inspections
             WHERE booking_id = ? AND inspection_stage = 'FINAL' AND is_confirmed = TRUE
             FOR UPDATE`,
            [bookingId]
        );

        let returnFinalized = false;
        let damageReported = false;
        let damageNotes = "";

        if (confirmedInspections.length >= 2) {
            returnFinalized = true;

            const damagedItems = confirmedInspections.filter(i => Boolean(i.is_damage_reported));
            if (damagedItems.length > 0) {
                damageReported = true;
                damageNotes = damagedItems.map(i => `${i.inspector_role}: ${i.damage_description || "Damage reported"}`).join(" | ");
            }

            if (damageReported) {
                // Rule 7: Do not automatically make damaged equipment AVAILABLE
                await connection.query(
                    `UPDATE equipment
                     SET status = 'DAMAGED'
                     WHERE id = ?`,
                    [booking.equipment_id]
                );

                // Update booking status to DISPUTED to resolve damage settlement
                await connection.query(
                    `UPDATE bookings
                     SET status = 'DISPUTED',
                         return_completed_at = NOW(),
                         cancellation_reason = ?
                     WHERE id = ?`,
                    [`Damage flagged during return: ${damageNotes}`, bookingId]
                );

                // Auto-create dispute in refund_disputes if not already present
                const [existingDisp] = await connection.query(
                    `SELECT id FROM refund_disputes WHERE booking_id = ? FOR UPDATE`,
                    [bookingId]
                );

                if (existingDisp.length === 0) {
                    // Find area admin for the equipment location
                    const [aaRows] = await connection.query(
                        `SELECT id FROM area_admins WHERE location_id = ? LIMIT 1`,
                        [booking.location_id]
                    );

                    await connection.query(
                        `INSERT INTO refund_disputes (
                            booking_id,
                            dispute_reason,
                            dispute_category,
                            raised_by_user_id,
                            raised_by_role,
                            status,
                            assigned_area_admin_id
                        ) VALUES (?, ?, 'EQUIPMENT_DAMAGE_DISPUTE', ?, ?, 'UNDER_ADMIN_REVIEW', ?)`,
                        [
                            bookingId,
                            `Return inspection damage flagged: ${damageNotes}`,
                            req.user.id,
                            role,
                            aaRows.length > 0 ? aaRows[0].id : null
                        ]
                    );
                }

            } else {
                // Return clean: restore equipment to AVAILABLE if no other active booking
                const [otherInProgress] = await connection.query(
                    `SELECT id FROM bookings
                     WHERE equipment_id = ?
                     AND status = 'IN_PROGRESS'
                     AND id != ?`,
                    [booking.equipment_id, bookingId]
                );

                if (otherInProgress.length > 0) {
                    await connection.query(
                        `UPDATE equipment SET status = 'IN_USE' WHERE id = ?`,
                        [booking.equipment_id]
                    );
                } else {
                    const [otherBooked] = await connection.query(
                        `SELECT id FROM bookings
                         WHERE equipment_id = ?
                         AND status IN ('ACCEPTED', 'CONFIRMED')
                         AND id != ?`,
                        [booking.equipment_id, bookingId]
                    );

                    if (otherBooked.length > 0) {
                        await connection.query(
                            `UPDATE equipment SET status = 'BOOKED' WHERE id = ?`,
                            [booking.equipment_id]
                        );
                    } else {
                        await connection.query(
                            `UPDATE equipment SET status = 'AVAILABLE' WHERE id = ?`,
                            [booking.equipment_id]
                        );
                    }
                }

                // Booking marked COMPLETED
                await connection.query(
                    `UPDATE bookings
                     SET status = 'COMPLETED',
                         return_completed_at = NOW()
                     WHERE id = ?`,
                    [bookingId]
                );
            }
        }

        await connection.commit();

        // 4. Send Return completion / Damage SMS alerts
        if (returnFinalized) {
            if (damageReported) {
                sendReturnDamageDisputeSMS({
                    recipientPhone: booking.owner_phone,
                    recipientName: booking.owner_name,
                    bookingId,
                    equipmentName: booking.equipment_name,
                    damageDescription: damageNotes
                }).catch(err => console.error("Damage SMS error:", err));

                sendReturnDamageDisputeSMS({
                    recipientPhone: booking.farmer_phone,
                    recipientName: booking.farmer_name,
                    bookingId,
                    equipmentName: booking.equipment_name,
                    damageDescription: damageNotes
                }).catch(err => console.error("Damage SMS error:", err));
            } else {
                sendReturnCompletedSMS({
                    recipientPhone: booking.owner_phone,
                    recipientName: booking.owner_name,
                    bookingId,
                    equipmentName: booking.equipment_name
                }).catch(err => console.error("Return complete SMS error:", err));

                sendReturnCompletedSMS({
                    recipientPhone: booking.farmer_phone,
                    recipientName: booking.farmer_name,
                    bookingId,
                    equipmentName: booking.equipment_name
                }).catch(err => console.error("Return complete SMS error:", err));
            }
        }

        return res.status(200).json({
            success: true,
            message: returnFinalized
                ? (damageReported
                    ? "Final inspection confirmed by both parties. Damage flagged: case routed to inspection dispute."
                    : "Final inspection confirmed by both parties. Equipment return finalized. Booking is COMPLETED.")
                : "Final inspection confirmed successfully. Awaiting counterpart confirmation to finalize return.",
            data: {
                bookingId: Number(bookingId),
                role,
                isConfirmed: true,
                returnFinalized,
                damageReported,
                bookingStatus: returnFinalized ? (damageReported ? "DISPUTED" : "COMPLETED") : "IN_PROGRESS",
                equipmentStatus: returnFinalized ? (damageReported ? "DAMAGED" : "AVAILABLE") : "IN_USE"
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Confirm final inspection error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to confirm final return inspection"
        });
    } finally {
        connection.release();
    }
};

/**
 * Get Stage 2 Final Return Inspection records.
 */
export const getFinalInspection = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await getAuthorizedBooking(bookingId, req.user);

        const [inspections] = await pool.query(
            `SELECT
                ei.*,
                u.full_name AS inspector_name,
                u.phone AS inspector_phone
             FROM equipment_inspections ei
             JOIN users u ON ei.inspector_user_id = u.id
             WHERE ei.booking_id = ? AND ei.inspection_stage = 'FINAL'
             ORDER BY ei.created_at ASC`,
            [bookingId]
        );

        for (const insp of inspections) {
            const [media] = await pool.query(
                `SELECT id, media_type, file_url, public_id, created_at
                 FROM inspection_media
                 WHERE inspection_id = ?`,
                [insp.id]
            );
            insp.media = media;
        }

        const ownerInspection = inspections.find(i => i.inspector_role === "OWNER") || null;
        const farmerInspection = inspections.find(i => i.inspector_role === "FARMER") || null;
        const isReturnReady = ownerInspection?.is_confirmed && farmerInspection?.is_confirmed;
        const hasDamage = inspections.some(i => Boolean(i.is_damage_reported));

        return res.status(200).json({
            success: true,
            data: {
                bookingId: Number(bookingId),
                equipmentId: booking.equipment_id,
                equipmentName: booking.equipment_name,
                bookingStatus: booking.booking_status,
                isReturnReady: Boolean(isReturnReady),
                hasDamage,
                returnCompletedAt: booking.return_completed_at,
                ownerInspection,
                farmerInspection
            }
        });

    } catch (error) {
        console.error("Get final inspection error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch final inspection"
        });
    }
};

/**
 * Get Complete Inspection History & Stage Comparison.
 */
export const getFullInspectionHistory = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const booking = await getAuthorizedBooking(bookingId, req.user);

        const [allInspections] = await pool.query(
            `SELECT
                ei.*,
                u.full_name AS inspector_name,
                u.phone AS inspector_phone
             FROM equipment_inspections ei
             JOIN users u ON ei.inspector_user_id = u.id
             WHERE ei.booking_id = ?
             ORDER BY ei.inspection_stage ASC, ei.created_at ASC`,
            [bookingId]
        );

        for (const insp of allInspections) {
            const [media] = await pool.query(
                `SELECT id, media_type, file_url, public_id, created_at
                 FROM inspection_media
                 WHERE inspection_id = ?`,
                [insp.id]
            );
            insp.media = media;
        }

        const initialOwner = allInspections.find(i => i.inspection_stage === "INITIAL" && i.inspector_role === "OWNER") || null;
        const initialFarmer = allInspections.find(i => i.inspection_stage === "INITIAL" && i.inspector_role === "FARMER") || null;
        const finalOwner = allInspections.find(i => i.inspection_stage === "FINAL" && i.inspector_role === "OWNER") || null;
        const finalFarmer = allInspections.find(i => i.inspection_stage === "FINAL" && i.inspector_role === "FARMER") || null;

        return res.status(200).json({
            success: true,
            data: {
                bookingId: Number(bookingId),
                equipmentId: booking.equipment_id,
                equipmentName: booking.equipment_name,
                bookingStatus: booking.booking_status,
                handoverCompletedAt: booking.handover_completed_at,
                returnCompletedAt: booking.return_completed_at,
                stage1: {
                    owner: initialOwner,
                    farmer: initialFarmer,
                    isHandoverComplete: Boolean(initialOwner?.is_confirmed && initialFarmer?.is_confirmed)
                },
                stage2: {
                    owner: finalOwner,
                    farmer: finalFarmer,
                    isReturnComplete: Boolean(finalOwner?.is_confirmed && finalFarmer?.is_confirmed)
                },
                inspections: allInspections
            }
        });

    } catch (error) {
        console.error("Get full inspection history error:", error);
        return res.status(error.statusCode || 500).json({
            success: false,
            message: error.message || "Failed to fetch inspection history"
        });
    }
};
