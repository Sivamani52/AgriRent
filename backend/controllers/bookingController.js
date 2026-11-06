import pool from "../db.js";

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

        let effectiveFarmerId;

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

        const [equipment] = await pool.query(
            `SELECT
                id,
                price_per_day,
                status,
                verification_status,
                location_id,
                owner_id
             FROM equipment
             WHERE id = ?`,
            [equipment_id]
        );

        if (equipment.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment not found"
            });
        }

        const selectedEquipment = equipment[0];

        // Restrict Area Admin from booking equipment outside their assigned area
        if (req.user.role === "AREA_ADMIN" && req.user.location_id) {
            if (selectedEquipment.location_id && selectedEquipment.location_id !== req.user.location_id) {
                return res.status(403).json({
                    success: false,
                    message: "Area Admin cannot book equipment outside their assigned area"
                });
            }
        }

        if (selectedEquipment.verification_status !== "VERIFIED") {
            return res.status(400).json({
                success: false,
                message: "Equipment is not verified"
            });
        }

        if (selectedEquipment.status !== "AVAILABLE") {
            return res.status(400).json({
                success: false,
                message: "Equipment is not currently available"
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

        if (endDate <= startDate) {
            return res.status(400).json({
                success: false,
                message: "End date must be after start date"
            });
        }

        const [overlappingBookings] = await pool.query(
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
             AND end_date > ?`,
            [
                equipment_id,
                end_date,
                start_date
            ]
        );

        if (overlappingBookings.length > 0) {
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
            return res.status(400).json({
                success: false,
                message: "Equipment does not have a valid daily rental price"
            });
        }

        const totalAmount = rentalDays * pricePerDay;

        const advanceAmount = totalAmount * 0.20;

        const [result] = await pool.query(
            `INSERT INTO bookings (
                equipment_id,
                farmer_id,
                start_date,
                end_date,
                price_per_day,
                total_amount,
                advance_amount,
                status
            )
            VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
            [
                equipment_id,
                effectiveFarmerId,
                start_date,
                end_date,
                pricePerDay,
                totalAmount,
                advanceAmount
            ]
        );

        return res.status(201).json({
            success: true,
            message: "Booking request created successfully",
            data: {
                bookingId: result.insertId,
                equipmentId: Number(equipment_id),
                farmerId: Number(effectiveFarmerId),
                startDate: start_date,
                endDate: end_date,
                rentalDays,
                pricePerDay,
                totalAmount,
                advanceAmount,
                status: "PENDING"
            }
        });

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
    try {
        const { bookingId } = req.params;

        // Retrieve authenticated owner profile
        const [ownerRows] = await pool.query(
            `SELECT id
             FROM owners
             WHERE user_id = ?`,
            [req.user.id]
        );

        if (ownerRows.length === 0) {
            return res.status(403).json({
                success: false,
                message: "Owner profile not found"
            });
        }

        const authenticatedOwnerId = ownerRows[0].id;

        const [bookings] = await pool.query(
            `SELECT
                b.id,
                b.equipment_id,
                b.status,
                b.created_at,
                (b.created_at <= DATE_SUB(NOW(), INTERVAL 4 HOUR)) AS is_expired,
                e.status AS equipment_status,
                e.owner_id
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
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

        // Equipment ownership validation: Owner can only accept bookings for their own equipment
        if (booking.owner_id !== authenticatedOwnerId) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to accept bookings for equipment you do not own"
            });
        }

        if (booking.status !== "PENDING") {
            return res.status(400).json({
                success: false,
                message: "Only pending bookings can be accepted"
            });
        }

        if (booking.is_expired) {
            await pool.query(
                `UPDATE bookings
                 SET status = 'CANCELLED',
                     cancellation_reason = 'Owner did not respond within the 4-hour deadline',
                     cancelled_at = NOW()
                 WHERE id = ? AND status = 'PENDING'`,
                [bookingId]
            );

            return res.status(400).json({
                success: false,
                message: "Booking acceptance deadline has expired. This booking has been cancelled."
            });
        }

        if (booking.equipment_status !== "AVAILABLE") {
            return res.status(400).json({
                success: false,
                message: "Equipment is no longer available"
            });
        }

        const paymentDeadline = new Date(
            Date.now() + 6 * 60 * 60 * 1000
        );

        await pool.query(
            `UPDATE bookings
            SET status = 'ACCEPTED',
                payment_deadline = ?
            WHERE id = ?`,
            [paymentDeadline, bookingId]
        );

        return res.status(200).json({
            success: true,
            message: "Booking accepted successfully",
            data: {
                bookingId: Number(bookingId),
                status: "ACCEPTED"
            }
        });

    } catch (error) {
        console.error(
            "Accept booking error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to accept booking"
        });
    }
};

export const rejectBooking = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Rejection reason is required"
            });
        }

        // Retrieve authenticated owner profile
        const [ownerRows] = await pool.query(
            `SELECT id
             FROM owners
             WHERE user_id = ?`,
            [req.user.id]
        );

        if (ownerRows.length === 0) {
            return res.status(403).json({
                success: false,
                message: "Owner profile not found"
            });
        }

        const authenticatedOwnerId = ownerRows[0].id;

        const [bookings] = await pool.query(
            `SELECT
                b.id,
                b.status,
                (b.created_at <= DATE_SUB(NOW(), INTERVAL 4 HOUR)) AS is_expired,
                e.owner_id
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
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

        // Equipment ownership validation: Owner can only reject bookings for their own equipment
        if (booking.owner_id !== authenticatedOwnerId) {
            return res.status(403).json({
                success: false,
                message: "You are not authorized to reject bookings for equipment you do not own"
            });
        }

        if (booking.status !== "PENDING") {
            return res.status(400).json({
                success: false,
                message: "Only pending bookings can be rejected"
            });
        }

        if (booking.is_expired) {
            await pool.query(
                `UPDATE bookings
                 SET status = 'CANCELLED',
                     cancellation_reason = 'Owner did not respond within the 4-hour deadline',
                     cancelled_at = NOW()
                 WHERE id = ? AND status = 'PENDING'`,
                [bookingId]
            );

            return res.status(400).json({
                success: false,
                message: "Booking acceptance deadline has expired. This booking has been cancelled."
            });
        }

        await pool.query(
            `UPDATE bookings
             SET status = 'REJECTED',
                 cancellation_reason = ?
             WHERE id = ?`,
            [reason.trim(), bookingId]
        );

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
        console.error(
            "Reject booking error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to reject booking"
        });
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
            const matchesArea = adminLocationId && (
                booking.equipment_location_id === adminLocationId ||
                booking.farmer_location_id === adminLocationId ||
                booking.owner_location_id === adminLocationId
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