import pool from "../db.js";

export const submitPayment = async (req, res) => {
    try {
        const { booking_id, transaction_id, payment_method } = req.body;

        if (!booking_id || !transaction_id || !payment_method) {
            return res.status(400).json({
                success: false,
                message: "booking_id, transaction_id and payment_method are required"
            });
        }

        if (!["UPI", "BANK_TRANSFER"].includes(payment_method)) {
            return res.status(400).json({
                success: false,
                message: "Invalid payment method"
            });
        }

        const [bookings] = await pool.query(
            `SELECT 
                id,
                advance_amount,
                status,
                payment_deadline,
                (payment_deadline > NOW()) AS payment_window_open
            FROM bookings
            WHERE id = ?`,
            [booking_id]
        );

        if (bookings.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        const booking = bookings[0];

         if (!booking.payment_window_open) {
                await pool.query(
                    `UPDATE bookings
                    SET status = 'CANCELLED',
                        cancellation_reason = 'Payment deadline expired'
                    WHERE id = ?`,
                    [booking_id]
                );

                return res.status(400).json({
                    success: false,
                    message: "Payment deadline has expired. Booking has been cancelled."
                });
            }

        if (booking.status !== "ACCEPTED") {
            return res.status(400).json({
                success: false,
                message: "Payment can only be submitted for an accepted booking"
            });
        }

        const [existingPayment] = await pool.query(
            `SELECT id
             FROM booking_payments
             WHERE booking_id = ?
             AND status IN ('PAYMENT_PENDING', 'PAYMENT_VERIFIED')`,
            [booking_id]
        );

        if (existingPayment.length > 0) {
            return res.status(400).json({
                success: false,
                message: "Payment has already been submitted for this booking"
            });
        }

        const [result] = await pool.query(
            `INSERT INTO booking_payments (
                booking_id,
                amount,
                transaction_id,
                payment_method,
                status,
                verification_deadline
            )
            VALUES (?, ?, ?, ?, 'PAYMENT_PENDING', DATE_ADD(NOW(), INTERVAL 2 HOUR))`,
            [
                booking_id,
                booking.advance_amount,
                transaction_id.trim(),
                payment_method
            ]
        );

        return res.status(201).json({
            success: true,
            message: "Payment details submitted successfully. Waiting for owner verification.",
            data: {
                paymentId: result.insertId,
                bookingId: Number(booking_id),
                amount: Number(booking.advance_amount),
                transactionId: transaction_id.trim(),
                paymentMethod: payment_method,
                status: "PAYMENT_PENDING"
            }
        });

    } catch (error) {
        console.error("Submit payment error:", error.message || error);

        return res.status(500).json({
            success: false,
            message: "Failed to submit payment"
        });
    }
};


export const verifyPayment = async (req, res) => {
    try {
        const { paymentId } = req.params;

        const [payments] = await pool.query(
            `SELECT
                bp.id,
                bp.booking_id,
                bp.amount,
                bp.transaction_id,
                bp.status,
                b.status AS booking_status
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             WHERE bp.id = ?`,
            [paymentId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = payments[0];

        if (payment.status !== "PAYMENT_PENDING") {
            return res.status(400).json({
                success: false,
                message: "Only pending payments can be verified"
            });
        }

        if (payment.booking_status !== "ACCEPTED") {
            return res.status(400).json({
                success: false,
                message: "Booking is not in accepted status"
            });
        }

        await pool.query(
            `UPDATE booking_payments
             SET status = 'PAYMENT_VERIFIED',
                 verified_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [paymentId]
        );

        await pool.query(
            `UPDATE bookings
             SET status = 'CONFIRMED'
             WHERE id = ?`,
            [payment.booking_id]
        );

        return res.status(200).json({
            success: true,
            message: "Payment verified successfully. Booking confirmed.",
            data: {
                paymentId: Number(paymentId),
                bookingId: payment.booking_id,
                amount: Number(payment.amount),
                transactionId: payment.transaction_id,
                paymentStatus: "PAYMENT_VERIFIED",
                bookingStatus: "CONFIRMED"
            }
        });

    } catch (error) {
        console.error("Verify payment error:", error.message || error);

        return res.status(500).json({
            success: false,
            message: "Failed to verify payment"
        });
    }
};

export const rejectPayment = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Rejection reason is required"
            });
        }

        const [payments] = await pool.query(
            `SELECT
                bp.id,
                bp.booking_id,
                bp.status,
                b.status AS booking_status
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             WHERE bp.id = ?`,
            [paymentId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = payments[0];

        if (payment.status !== "PAYMENT_PENDING") {
            return res.status(400).json({
                success: false,
                message: "Only pending payments can be rejected"
            });
        }

        if (payment.booking_status !== "ACCEPTED") {
            return res.status(400).json({
                success: false,
                message: "Booking is not in accepted status"
            });
        }

        await pool.query(
            `UPDATE booking_payments
             SET status = 'PAYMENT_REJECTED',
                 rejection_reason = ?
             WHERE id = ?`,
            [reason.trim(), paymentId]
        );

        return res.status(200).json({
            success: true,
            message: "Payment rejected successfully",
            data: {
                paymentId: Number(paymentId),
                bookingId: payment.booking_id,
                paymentStatus: "PAYMENT_REJECTED",
                reason: reason.trim()
            }
        });

    } catch (error) {
        console.error("Reject payment error:", error.message || error);

        return res.status(500).json({
            success: false,
            message: "Failed to reject payment"
        });
    }
};

export const submitRefund = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const { refund_transaction_id } = req.body;

        if (!refund_transaction_id || refund_transaction_id.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Refund transaction ID is required"
            });
        }

        const [payments] = await pool.query(
            `SELECT
                id,
                booking_id,
                amount,
                status,
                refund_deadline,
                (refund_deadline > NOW()) AS refund_window_open
            FROM booking_payments
            WHERE id = ?`,
            [paymentId]
        );

        if (payments.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = payments[0];

        if (payment.status !== "PAYMENT_REJECTED") {
            return res.status(400).json({
                success: false,
                message: "Refund can only be submitted for a rejected payment"
            });
        }

        if (!payment.refund_deadline) {
            return res.status(400).json({
                success: false,
                message: "Refund deadline is not available"
            });
        }

        if (!payment.refund_window_open) {
            return res.status(400).json({
                success: false,
                message: "Refund deadline has expired. Area Admin will handle the refund."
            });
        }

        await pool.query(
            `UPDATE booking_payments
             SET refund_transaction_id = ?,
                 refund_submitted_at = NOW()
             WHERE id = ?`,
            [
                refund_transaction_id.trim(),
                paymentId
            ]
        );

        return res.status(200).json({
            success: true,
            message: "Refund details submitted successfully. Waiting for verification.",
            data: {
                paymentId: Number(paymentId),
                bookingId: payment.booking_id,
                refundAmount: Number(payment.amount),
                refundTransactionId: refund_transaction_id.trim(),
                refundSubmittedAt: new Date(),
                status: "PAYMENT_REJECTED"
            }
        });

    } catch (error) {
        console.error(
            "Submit refund error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to submit refund"
        });
    }
};