import pool from "../db.js";
import {
    sendBookingRequestEmail,
    sendBookingAcceptedEmail,
    sendBookingRejectedEmail,
    sendBookingCancelledEmail
} from "../services/notificationService.js";

export const createBooking = async (req, res) => {
    try {
        const {
            equipment_id,
            farmer_id,
            start_date,
            end_date
        } = req.body;

        if (
            !equipment_id ||
            !start_date ||
            !end_date ||
            (req.user.role === "AREA_ADMIN" && !farmer_id)
        ) {
            return res.status(400).json({
                success: false,
                message: req.user.role === "AREA_ADMIN"
                    ? "equipment_id, farmer_id, start_date and end_date are required"
                    : "equipment_id, start_date and end_date are required"
            });
        }

        const startDate = new Date(start_date);
        const endDate = new Date(end_date);

        if (
            Number.isNaN(startDate.getTime()) ||
            Number.isNaN(endDate.getTime())
        ) {
            return res.status(400).json({
                success: false,
                message: "Invalid start_date or end_date"
            });
        }

        const today = new Date();
        today.setHours(0, 0, 0, 0);

        let startDay;
        if (typeof start_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
            const [y, m, d] = start_date.split("-").map(Number);
            startDay = new Date(y, m - 1, d, 0, 0, 0, 0);
        } else {
            startDay = new Date(startDate);
            startDay.setHours(0, 0, 0, 0);
        }

        if (startDay < today) {
            return res.status(400).json({
                success: false,
                message: "Rental start date cannot be in the past"
            });
        }

        if (endDate <= startDate) {
            return res.status(400).json({
                success: false,
                message: "End date must be after start date"
            });
        }

        let effectiveFarmerId;
        let assistedByUserId = null;

        // Role-based farmer resolution and ownership check
        if (req.user.role === "FARMER") {
            const [farmerRows] = await pool.query(
                `SELECT id, location_id
                 FROM farmers
                 WHERE user_id = ?`,
                [req.user.id]
            );

            if (farmerRows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Farmer profile not found for authenticated user"
                });
            }

            effectiveFarmerId = farmerRows[0].id;
            assistedByUserId = null;

            // Reject if farmer attempts to specify a different farmer's ID
            if (farmer_id && Number(farmer_id) !== effectiveFarmerId) {
                return res.status(403).json({
                    success: false,
                    message: "You cannot create a booking on behalf of another farmer"
                });
            }
        } else if (req.user.role === "AREA_ADMIN") {
            // Assisted booking: Area Admin booking on behalf of a farmer
            const [farmerRows] = await pool.query(
                `SELECT id, location_id
                 FROM farmers
                 WHERE id = ?`,
                [farmer_id]
            );

            if (farmerRows.length === 0) {
                return res.status(404).json({
                    success: false,
                    message: "Farmer not found"
                });
            }

            const assistedFarmer = farmerRows[0];
            effectiveFarmerId = assistedFarmer.id;
            assistedByUserId = req.user.id;

            // Restrict Area Admin to assigned area
            const adminLocationId = req.user.location_id;
            if (adminLocationId) {
                if (assistedFarmer.location_id && assistedFarmer.location_id !== adminLocationId) {
                    return res.status(403).json({
                        success: false,
                        message: "Area Admin cannot create bookings for farmers outside their assigned area"
                    });
                }
            }
        } else {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to create bookings"
            });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();

            const [equipment] = await connection.query(
                `SELECT
                    e.id,
                    e.name,
                    e.price_per_day,
                    e.status,
                    e.verification_status,
                    e.location_id,
                    e.owner_id,
                    ou.email AS owner_email,
                    ou.phone AS owner_phone,
                    ou.full_name AS owner_name
                 FROM equipment e
                 JOIN owners o ON e.owner_id = o.id
                 JOIN users ou ON o.user_id = ou.id
                 WHERE e.id = ?
                 FOR UPDATE`,
                [equipment_id]
            );

            if (equipment.length === 0) {
                await connection.rollback();
                return res.status(404).json({
                    success: false,
                    message: "Equipment not found"
                });
            }

            const selectedEquipment = equipment[0];

            // Restrict Area Admin from booking equipment outside their assigned area
            if (req.user.role === "AREA_ADMIN" && req.user.location_id) {
                if (selectedEquipment.location_id && selectedEquipment.location_id !== req.user.location_id) {
                    await connection.rollback();
                    return res.status(403).json({
                        success: false,
                        message: "Area Admin cannot book equipment outside their assigned area"
                    });
                }
            }

            if (selectedEquipment.verification_status !== "VERIFIED") {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: "Equipment is not verified"
                });
            }

            if (selectedEquipment.status !== "AVAILABLE") {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: "Equipment is not currently available"
                });
            }

            // Lock and check overlapping bookings inside the transaction
            const [overlappingBookings] = await connection.query(
                `SELECT id
                 FROM bookings
                 WHERE equipment_id = ?
                 AND status IN (
                    'PENDING',
                    'ACCEPTED',
                    'CONFIRMED',
                    'IN_PROGRESS'
                 )
                 AND start_date < ?
                 AND end_date > ?
                 FOR UPDATE`,
                [
                    equipment_id,
                    end_date,
                    start_date
                ]
            );

            if (overlappingBookings.length > 0) {
                await connection.rollback();
                return res.status(409).json({
                    success: false,
                    message: "Equipment is already booked for the selected dates"
                });
            }

            const millisecondsPerDay = 1000 * 60 * 60 * 24;

            const rentalDays = Math.ceil(
                (endDate - startDate) / millisecondsPerDay
            );

            const pricePerDay = Number(
                selectedEquipment.price_per_day
            );

            if (!pricePerDay || pricePerDay <= 0) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: "Equipment does not have a valid daily rental price"
                });
            }

            const totalAmount = Number((rentalDays * pricePerDay).toFixed(2));

            const advanceAmount = Number((totalAmount * 0.20).toFixed(2));

            const [result] = await connection.query(
                `INSERT INTO bookings (
                    equipment_id,
                    farmer_id,
                    assisted_by_user_id,
                    start_date,
                    end_date,
                    price_per_day,
                    total_amount,
                    advance_amount,
                    status
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
                [
                    equipment_id,
                    effectiveFarmerId,
                    assistedByUserId,
                    start_date,
                    end_date,
                    pricePerDay,
                    totalAmount,
                    advanceAmount
                ]
            );

            await connection.commit();

            sendBookingRequestEmail({
                ownerEmail: selectedEquipment.owner_email,
                ownerName: selectedEquipment.owner_name,
                equipmentName: selectedEquipment.name,
                bookingId: result.insertId,
                totalAmount,
                advanceAmount
            }).catch(err => console.error("Booking request email error:", err));

            return res.status(201).json({
                success: true,
                message: "Booking request created successfully",
                data: {
                    bookingId: result.insertId,
                    equipmentId: Number(equipment_id),
                    farmerId: Number(effectiveFarmerId),
                    assistedByUserId: assistedByUserId ? Number(assistedByUserId) : null,
                    startDate: start_date,
                    endDate: end_date,
                    rentalDays,
                    pricePerDay,
                    totalAmount,
                    advanceAmount,
                    status: "PENDING"
                }
            });

        } catch (trxErr) {
            await connection.rollback();
            throw trxErr;
        } finally {
            connection.release();
        }

    } catch (error) {
        console.error(
            "Create booking error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to create booking"
        });
    }
};

export const acceptBooking = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const { bookingId } = req.params;

        // Retrieve authenticated owner profile
        const [ownerRows] = await connection.query(
            `SELECT id
             FROM owners
             WHERE user_id = ?`,
            [req.user.id]
        );

        if (ownerRows.length === 0) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "Owner profile not found"
            });
        }

        const authenticatedOwnerId = ownerRows[0].id;

        const [bookings] = await connection.query(
            `SELECT
                b.id,
                b.equipment_id,
                b.status,
                b.advance_amount,
                b.created_at,
                (b.created_at <= DATE_SUB(NOW(), INTERVAL 4 HOUR)) AS is_expired,
                e.status AS equipment_status,
                e.name AS equipment_name,
                e.owner_id,
                fu.email AS farmer_email,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE b.id = ?
             FOR UPDATE`,
            [bookingId]
        );

        if (bookings.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        const booking = bookings[0];

        // Equipment ownership validation: Owner can only accept bookings for their own equipment
        if (booking.owner_id !== authenticatedOwnerId) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "You are not authorized to accept bookings for equipment you do not own"
            });
        }

        if (booking.status !== "PENDING") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Only pending bookings can be accepted"
            });
        }

        if (booking.is_expired) {
            await connection.query(
                `UPDATE bookings
                 SET status = 'CANCELLED',
                     cancellation_reason = 'Owner did not respond within the 4-hour deadline',
                     cancelled_at = NOW()
                 WHERE id = ? AND status = 'PENDING'`,
                [bookingId]
            );
            await connection.commit();

            return res.status(400).json({
                success: false,
                message: "Booking acceptance deadline has expired. This booking has been cancelled."
            });
        }

        if (booking.equipment_status !== "AVAILABLE") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Equipment is no longer available"
            });
        }

        const paymentDeadline = new Date(
            Date.now() + 6 * 60 * 60 * 1000
        );

        await connection.query(
            `UPDATE bookings
            SET status = 'ACCEPTED',
                payment_deadline = ?
            WHERE id = ?`,
            [paymentDeadline, bookingId]
        );

        await connection.commit();

        sendBookingAcceptedEmail({
            farmerEmail: booking.farmer_email,
            farmerName: booking.farmer_name,
            equipmentName: booking.equipment_name,
            bookingId: Number(bookingId),
            advanceAmount: booking.advance_amount
        }).catch(err => console.error("Booking accepted email error:", err));

        return res.status(200).json({
            success: true,
            message: "Booking accepted successfully",
            data: {
                bookingId: Number(bookingId),
                status: "ACCEPTED"
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error(
            "Accept booking error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to accept booking"
        });
    } finally {
        connection.release();
    }
};

export const rejectBooking = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { bookingId } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Rejection reason is required"
            });
        }

        await connection.beginTransaction();

        // Retrieve authenticated owner profile
        const [ownerRows] = await connection.query(
            `SELECT id
             FROM owners
             WHERE user_id = ?`,
            [req.user.id]
        );

        if (ownerRows.length === 0) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "Owner profile not found"
            });
        }

        const authenticatedOwnerId = ownerRows[0].id;

        const [bookings] = await connection.query(
            `SELECT
                b.id,
                b.status,
                (b.created_at <= DATE_SUB(NOW(), INTERVAL 4 HOUR)) AS is_expired,
                e.owner_id,
                e.name AS equipment_name,
                fu.email AS farmer_email,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE b.id = ?
             FOR UPDATE`,
            [bookingId]
        );

        if (bookings.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        const booking = bookings[0];

        // Equipment ownership validation: Owner can only reject bookings for their own equipment
        if (booking.owner_id !== authenticatedOwnerId) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "You are not authorized to reject bookings for equipment you do not own"
            });
        }

        if (booking.status !== "PENDING") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Only pending bookings can be rejected"
            });
        }

        if (booking.is_expired) {
            await connection.query(
                `UPDATE bookings
                 SET status = 'CANCELLED',
                     cancellation_reason = 'Owner did not respond within the 4-hour deadline',
                     cancelled_at = NOW()
                 WHERE id = ? AND status = 'PENDING'`,
                [bookingId]
            );
            await connection.commit();

            return res.status(400).json({
                success: false,
                message: "Booking acceptance deadline has expired. This booking has been cancelled."
            });
        }

        await connection.query(
            `UPDATE bookings
             SET status = 'REJECTED',
                 cancellation_reason = ?
             WHERE id = ?`,
            [reason.trim(), bookingId]
        );

        await connection.commit();

        sendBookingRejectedEmail({
            farmerEmail: booking.farmer_email,
            farmerName: booking.farmer_name,
            equipmentName: booking.equipment_name,
            bookingId: Number(bookingId),
            reason: reason.trim()
        }).catch(err => console.error("Booking rejected email error:", err));

        return res.status(200).json({
            success: true,
            message: "Booking rejected successfully",
            data: {
                bookingId: Number(bookingId),
                status: "REJECTED",
                reason: reason.trim()
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error(
            "Reject booking error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to reject booking"
        });
    } finally {
        connection.release();
    }
};

/**
 * Cancel a booking (FARMER owner of booking, AREA_ADMIN in assigned area / who assisted, or SUPER_ADMIN).
 * Allowed when status is PENDING or ACCEPTED.
 */
export const cancelBooking = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { bookingId } = req.params;
        const { reason } = req.body || {};

        await connection.beginTransaction();

        const [bookings] = await connection.query(
            `SELECT
                b.id,
                b.status,
                b.equipment_id,
                b.farmer_id,
                b.assisted_by_user_id,
                f.user_id AS farmer_user_id,
                f.location_id AS farmer_location_id,
                fu.email AS farmer_email,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name,
                e.name AS equipment_name,
                e.owner_id,
                e.location_id AS equipment_location_id,
                ou.email AS owner_email,
                ou.phone AS owner_phone,
                ou.full_name AS owner_name
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

        // Access control:
        // Only the farmer who created the booking, an Area Admin in the relevant area (or who assisted), or Super Admin can cancel
        const isBookingFarmer = req.user.role === "FARMER" && booking.farmer_user_id === req.user.id;
        const isAreaAdmin = req.user.role === "AREA_ADMIN" && (
            booking.assisted_by_user_id === req.user.id ||
            !req.user.location_id ||
            booking.farmer_location_id === req.user.location_id ||
            booking.equipment_location_id === req.user.location_id
        );
        const isSuperAdmin = req.user.role === "SUPER_ADMIN";

        if (!isBookingFarmer && !isAreaAdmin && !isSuperAdmin) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "You are not authorized to cancel this booking"
            });
        }

        // Validate status: Only PENDING or ACCEPTED bookings can be cancelled
        if (booking.status === "CANCELLED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "This booking is already cancelled"
            });
        }

        if (booking.status !== "PENDING" && booking.status !== "ACCEPTED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: `Cannot cancel a booking in '${booking.status}' status`
            });
        }

        const cancellationReason = (reason && reason.trim()) || "Cancelled by user";

        await connection.query(
            `UPDATE bookings
             SET status = 'CANCELLED',
                 cancellation_reason = ?,
                 cancelled_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [cancellationReason, bookingId]
        );

        // If there was an active payment, mark refund required
        await connection.query(
            `UPDATE booking_payments
             SET status = 'PAYMENT_REJECTED',
                 refund_status = 'REFUND_REQUIRED',
                 refund_required_at = CURRENT_TIMESTAMP,
                 refund_deadline = DATE_ADD(CURRENT_TIMESTAMP, INTERVAL 24 HOUR)
             WHERE booking_id = ? AND status = 'PAYMENT_PENDING'`,
            [bookingId]
        );

        await connection.commit();

        // Dispatch notifications to owner and farmer (non-blocking)
        if (booking.farmer_email) {
            sendBookingCancelledEmail({
                recipientEmail: booking.farmer_email,
                recipientName: booking.farmer_name,
                recipientRole: "FARMER",
                bookingId: Number(bookingId),
                equipmentName: booking.equipment_name,
                reason: cancellationReason
            }).catch(err => console.error("Cancel booking farmer email error:", err));
        }

        if (booking.owner_email) {
            sendBookingCancelledEmail({
                recipientEmail: booking.owner_email,
                recipientName: booking.owner_name,
                recipientRole: "OWNER",
                bookingId: Number(bookingId),
                equipmentName: booking.equipment_name,
                reason: cancellationReason
            }).catch(err => console.error("Cancel booking owner email error:", err));
        }

        return res.status(200).json({
            success: true,
            message: "Booking cancelled successfully",
            data: {
                bookingId: Number(bookingId),
                status: "CANCELLED",
                cancellationReason
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Cancel booking error:", error);
        return res.status(500).json({
            success: false,
            message: "Failed to cancel booking"
        });
    } finally {
        connection.release();
    }
};

export const getBookingById = async (req, res) => {
    try {
        const { bookingId } = req.params;

        const [bookings] = await pool.query(
            `SELECT
                b.id AS booking_id,
                b.start_date,
                b.end_date,
                b.price_per_day,
                b.total_amount,
                b.advance_amount,
                b.status,
                b.assisted_by_user_id,
                au.full_name AS assisted_by_name,
                b.cancellation_reason,
                b.created_at,

                e.id AS equipment_id,
                e.name AS equipment_name,
                e.equipment_type,
                e.location_id AS equipment_location_id,

                f.id AS farmer_id,
                f.user_id AS farmer_user_id,
                f.location_id AS farmer_location_id,
                u.full_name AS farmer_name,
                u.phone AS farmer_phone,

                o.id AS owner_id,
                o.user_id AS owner_user_id,
                o.location_id AS owner_location_id,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone

             FROM bookings b

             JOIN equipment e
                ON b.equipment_id = e.id

             JOIN farmers f
                ON b.farmer_id = f.id

             JOIN users u
                ON f.user_id = u.id

             JOIN owners o
                ON e.owner_id = o.id

             JOIN users ou
                ON o.user_id = ou.id

             LEFT JOIN users au
                ON b.assisted_by_user_id = au.id

             WHERE b.id = ?`,
            [bookingId]
        );

        if (bookings.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        const booking = bookings[0];
        const { role, id: userId, location_id: adminLocationId } = req.user;

        // Role-based Access and Ownership Validation
        if (role === "FARMER") {
            if (booking.farmer_user_id !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to view this booking"
                });
            }
        } else if (role === "OWNER") {
            if (booking.owner_user_id !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to view this booking"
                });
            }
        } else if (role === "AREA_ADMIN") {
            const matchesArea = (
                (adminLocationId && (
                    booking.equipment_location_id === adminLocationId ||
                    booking.farmer_location_id === adminLocationId ||
                    booking.owner_location_id === adminLocationId
                )) ||
                booking.assisted_by_user_id === userId
            );

            if (!matchesArea) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to view bookings outside your assigned area"
                });
            }
        } else if (role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to view this booking"
            });
        }

        // Strip internal permission validation fields before sending response
        const {
            farmer_user_id,
            owner_user_id,
            equipment_location_id,
            farmer_location_id,
            owner_location_id,
            ...bookingData
        } = booking;

        return res.status(200).json({
            success: true,
            data: bookingData
        });

    } catch (error) {
        console.error(
            "Get booking by ID error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to get booking"
        });
    }
};

export const getFarmerBookings = async (req, res) => {
    try {
        const { farmerId } = req.params;

        const [farmerRows] = await pool.query(
            `SELECT id, user_id, location_id
             FROM farmers
             WHERE id = ?`,
            [farmerId]
        );

        if (farmerRows.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Farmer not found"
            });
        }

        const farmer = farmerRows[0];
        const { role, id: userId, location_id: adminLocationId } = req.user;

        // Role-based Access and Ownership Check
        if (role === "FARMER") {
            if (farmer.user_id !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to view another farmer's bookings"
                });
            }
        } else if (role === "AREA_ADMIN") {
            if (!adminLocationId || (farmer.location_id && farmer.location_id !== adminLocationId)) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to view bookings for farmers outside your assigned area"
                });
            }
        } else if (role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action"
            });
        }

        const [bookings] = await pool.query(
            `SELECT
                b.id AS booking_id,
                b.start_date,
                b.end_date,
                b.price_per_day,
                b.total_amount,
                b.advance_amount,
                b.status,
                b.cancellation_reason,
                b.created_at,

                e.id AS equipment_id,
                e.name AS equipment_name,
                e.equipment_type,

                o.id AS owner_id,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone

             FROM bookings b

             JOIN equipment e
                ON b.equipment_id = e.id

             JOIN owners o
                ON e.owner_id = o.id

             JOIN users ou
                ON o.user_id = ou.id

             WHERE b.farmer_id = ?

             ORDER BY b.created_at DESC`,
            [farmerId]
        );

        return res.status(200).json({
            success: true,
            count: bookings.length,
            data: bookings
        });

    } catch (error) {
        console.error(
            "Get farmer bookings error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to get farmer bookings"
        });
    }
};

export const getOwnerBookings = async (req, res) => {
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
        const { role, id: userId, location_id: adminLocationId } = req.user;

        // Role-based Access and Ownership Check
        if (role === "OWNER") {
            if (owner.user_id !== userId) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to view another owner's bookings"
                });
            }
        } else if (role === "AREA_ADMIN") {
            if (!adminLocationId || (owner.location_id && owner.location_id !== adminLocationId)) {
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to view bookings for owners outside your assigned area"
                });
            }
        } else if (role !== "SUPER_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action"
            });
        }

        const [bookings] = await pool.query(
            `SELECT
                b.id AS booking_id,
                b.start_date,
                b.end_date,
                b.price_per_day,
                b.total_amount,
                b.advance_amount,
                b.status,
                b.cancellation_reason,
                b.created_at,

                e.id AS equipment_id,
                e.name AS equipment_name,
                e.equipment_type,

                f.id AS farmer_id,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone

             FROM bookings b

             JOIN equipment e
                ON b.equipment_id = e.id

             JOIN farmers f
                ON b.farmer_id = f.id

             JOIN users fu
                ON f.user_id = fu.id

             WHERE e.owner_id = ?

             ORDER BY b.created_at DESC`,
            [ownerId]
        );

        return res.status(200).json({
            success: true,
            count: bookings.length,
            data: bookings
        });

    } catch (error) {
        console.error(
            "Get owner bookings error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to get owner bookings"
        });
    }
};

export const getAllBookings = async (req, res) => {
    try {
        const { role, location_id: adminLocationId, id: userId } = req.user;

        if (role !== "SUPER_ADMIN" && role !== "AREA_ADMIN") {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to view all bookings"
            });
        }

        const {
            status,
            start_date,
            end_date,
            farmer_id,
            owner_id,
            equipment_id,
            page = 1,
            limit = 20
        } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const conditions = [];
        const params = [];

        // Scoping for AREA_ADMIN:
        if (role === "AREA_ADMIN") {
            if (adminLocationId) {
                conditions.push("(e.location_id = ? OR f.location_id = ? OR o.location_id = ? OR b.assisted_by_user_id = ?)");
                params.push(adminLocationId, adminLocationId, adminLocationId, userId);
            } else {
                conditions.push("b.assisted_by_user_id = ?");
                params.push(userId);
            }
        }

        // Query Filters
        if (status) {
            conditions.push("b.status = ?");
            params.push(status);
        }
        if (farmer_id) {
            conditions.push("b.farmer_id = ?");
            params.push(farmer_id);
        }
        if (owner_id) {
            conditions.push("e.owner_id = ?");
            params.push(owner_id);
        }
        if (equipment_id) {
            conditions.push("b.equipment_id = ?");
            params.push(equipment_id);
        }
        if (start_date) {
            conditions.push("b.start_date >= ?");
            params.push(start_date);
        }
        if (end_date) {
            conditions.push("b.end_date <= ?");
            params.push(end_date);
        }

        const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

        // Count query
        const [countResult] = await pool.query(
            `SELECT COUNT(b.id) AS total
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN owners o ON e.owner_id = o.id
             ${whereClause}`,
            params
        );
        const total = countResult[0].total;

        // Data query
        const [bookings] = await pool.query(
            `SELECT
                b.id AS booking_id,
                b.start_date,
                b.end_date,
                b.price_per_day,
                b.total_amount,
                b.advance_amount,
                b.status,
                b.cancellation_reason,
                b.assisted_by_user_id,
                b.created_at,

                e.id AS equipment_id,
                e.name AS equipment_name,
                e.equipment_type,
                e.location_id AS equipment_location_id,

                f.id AS farmer_id,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone,
                fu.email AS farmer_email,

                o.id AS owner_id,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                ou.email AS owner_email,

                au.full_name AS assisted_by_name

             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             LEFT JOIN users au ON b.assisted_by_user_id = au.id
             ${whereClause}
             ORDER BY b.created_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        return res.status(200).json({
            success: true,
            pagination: {
                page: pageNum,
                limit: limitNum,
                total,
                totalPages: Math.ceil(total / limitNum)
            },
            count: bookings.length,
            data: bookings
        });
    } catch (error) {
        console.error("Get all bookings error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to get bookings"
        });
    }
};