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