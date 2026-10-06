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
            !farmer_id ||
            !start_date ||
            !end_date
        ) {
            return res.status(400).json({
                success: false,
                message: "equipment_id, farmer_id, start_date and end_date are required"
            });
        }

        const [farmer] = await pool.query(
            `SELECT id
             FROM farmers
             WHERE id = ?`,
            [farmer_id]
        );

        if (farmer.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Farmer not found"
            });
        }

        const [equipment] = await pool.query(
            `SELECT
                id,
                price_per_day,
                status,
                verification_status
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
                farmer_id,
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
                farmerId: Number(farmer_id),
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

        const [bookings] = await pool.query(
            `SELECT
                b.id,
                b.equipment_id,
                b.status,
                e.status AS equipment_status
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

        if (booking.status !== "PENDING") {
            return res.status(400).json({
                success: false,
                message: "Only pending bookings can be accepted"
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

        const [bookings] = await pool.query(
            `SELECT id, status
             FROM bookings
             WHERE id = ?`,
            [bookingId]
        );

        if (bookings.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        const booking = bookings[0];

        if (booking.status !== "PENDING") {
            return res.status(400).json({
                success: false,
                message: "Only pending bookings can be rejected"
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

                f.id AS farmer_id,
                u.full_name AS farmer_name,
                u.phone AS farmer_phone,

                o.id AS owner_id,
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

        return res.status(200).json({
            success: true,
            data: bookings[0]
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

        const [farmer] = await pool.query(
            `SELECT id
             FROM farmers
             WHERE id = ?`,
            [farmerId]
        );

        if (farmer.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Farmer not found"
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