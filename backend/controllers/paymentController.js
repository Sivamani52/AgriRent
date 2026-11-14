import pool from "../db.js";
import {
    sendPaymentSubmittedEmail,
    sendPaymentVerifiedEmail,
    sendPaymentRejectedEmail,
    sendRefundInitiatedEmail,
    sendRefundDisputeEmail,
    sendAreaAdminDisputeEmail
} from "../services/notificationService.js";

/**
 * Farmer submits advance payment for an accepted booking.
 * Access: Authenticated FARMER associated with the booking.
 */
export const submitPayment = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { booking_id, transaction_id, payment_method } = req.body;

        if (!booking_id || !transaction_id || !payment_method) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "booking_id, transaction_id and payment_method are required"
            });
        }

        if (!["UPI", "BANK_TRANSFER"].includes(payment_method)) {
            connection.release();
            return res.status(400).json({
                success: false,
                message: "Invalid payment method"
            });
        }

        await connection.beginTransaction();

        const [bookings] = await connection.query(
            `SELECT 
                b.id,
                b.farmer_id,
                b.advance_amount,
                b.status,
                b.payment_deadline,
                (b.payment_deadline > NOW()) AS payment_window_open,
                f.user_id AS farmer_user_id,
                ou.email AS owner_email,
                ou.phone AS owner_phone,
                ou.full_name AS owner_name,
                e.name AS equipment_name
            FROM bookings b
            JOIN farmers f ON b.farmer_id = f.id
            JOIN equipment e ON b.equipment_id = e.id
            JOIN owners o ON e.owner_id = o.id
            JOIN users ou ON o.user_id = ou.id
            WHERE b.id = ?
            FOR UPDATE`,
            [booking_id]
        );

        if (bookings.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Booking not found"
            });
        }

        const booking = bookings[0];

        // IDOR Prevention: Only the farmer associated with this booking can pay
        if (booking.farmer_user_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "You are not authorized to submit payment for this booking"
            });
        }

        if (!booking.payment_window_open) {
            await connection.query(
                `UPDATE bookings
                 SET status = 'CANCELLED',
                     cancellation_reason = 'Payment deadline expired'
                 WHERE id = ?`,
                [booking_id]
            );
            await connection.commit();

            return res.status(400).json({
                success: false,
                message: "Payment deadline has expired. Booking has been cancelled."
            });
        }

        if (booking.status !== "ACCEPTED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Payment can only be submitted for an accepted booking"
            });
        }

        const [existingPayment] = await connection.query(
            `SELECT id
             FROM booking_payments
             WHERE booking_id = ?
             AND status IN ('PAYMENT_PENDING', 'PAYMENT_VERIFIED')
             FOR UPDATE`,
            [booking_id]
        );

        if (existingPayment.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Payment has already been submitted for this booking"
            });
        }

        const [existingTxn] = await connection.query(
            `SELECT id FROM booking_payments WHERE transaction_id = ?`,
            [transaction_id.trim()]
        );

        if (existingTxn.length > 0) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "This transaction ID has already been recorded"
            });
        }

        const [result] = await connection.query(
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

        await connection.commit();

        // Send Email notification to owner (Event 6)
        sendPaymentSubmittedEmail({
            ownerEmail: booking.owner_email,
            ownerName: booking.owner_name,
            bookingId: booking_id,
            amount: booking.advance_amount,
            transactionId: transaction_id.trim(),
            equipmentName: booking.equipment_name
        }).catch(err => console.error("Payment submitted email error:", err));

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
        await connection.rollback();
        console.error("Submit payment error:", error.message || error);

        return res.status(500).json({
            success: false,
            message: "Failed to submit payment"
        });
    } finally {
        connection.release();
    }
};

/**
 * Owner verifies advance payment.
 * Protected with MySQL transactions and SELECT ... FOR UPDATE row locking.
 * Access: Authenticated equipment OWNER of this booking only.
 */
export const verifyPayment = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { paymentId } = req.params;

        await connection.beginTransaction();

        // Row-locking payment and booking records
        const [payments] = await connection.query(
            `SELECT
                bp.id,
                bp.booking_id,
                bp.amount,
                bp.transaction_id,
                bp.status,
                b.status AS booking_status,
                b.equipment_id,
                o.user_id AS owner_user_id,
                fu.email AS farmer_email,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name,
                e.name AS equipment_name
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE bp.id = ?
             FOR UPDATE`,
            [paymentId]
        );

        if (payments.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = payments[0];

        // Authorization check: Only authorized owner of this booking can verify
        if (payment.owner_user_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "You are not authorized to verify payment for this booking"
            });
        }

        if (payment.status === "PAYMENT_VERIFIED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Payment has already been verified"
            });
        }

        if (payment.status !== "PAYMENT_PENDING") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Only pending payments can be verified"
            });
        }

        if (payment.booking_status !== "ACCEPTED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Booking is not in accepted status"
            });
        }

        // Lock booking row as well
        await connection.query(
            "SELECT id FROM bookings WHERE id = ? FOR UPDATE",
            [payment.booking_id]
        );

        // Update payment status
        await connection.query(
            `UPDATE booking_payments
             SET status = 'PAYMENT_VERIFIED',
                 verified_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
            [paymentId]
        );

        // Update booking status
        await connection.query(
            `UPDATE bookings
             SET status = 'CONFIRMED'
             WHERE id = ?`,
            [payment.booking_id]
        );

        // Update equipment status to BOOKED if it was AVAILABLE
        await connection.query(
            `UPDATE equipment
             SET status = 'BOOKED'
             WHERE id = ? AND status = 'AVAILABLE'`,
            [payment.equipment_id]
        );

        await connection.commit();

        // Send Email to Farmer (Event 7, non-blocking)
        sendPaymentVerifiedEmail({
            farmerEmail: payment.farmer_email,
            farmerName: payment.farmer_name,
            bookingId: payment.booking_id,
            amount: payment.amount,
            equipmentName: payment.equipment_name
        }).catch(err => console.error("Payment verified email error:", err));

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
        await connection.rollback();
        console.error("Verify payment error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to verify payment"
        });
    } finally {
        connection.release();
    }
};

/**
 * Owner rejects advance payment.
 * Protected with MySQL transactions and SELECT ... FOR UPDATE row locking.
 * Access: Authenticated equipment OWNER of this booking only.
 */
export const rejectPayment = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { paymentId } = req.params;
        const { reason } = req.body;

        if (!reason || reason.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Rejection reason is required"
            });
        }

        await connection.beginTransaction();

        const [payments] = await connection.query(
            `SELECT
                bp.id,
                bp.booking_id,
                bp.amount,
                bp.status,
                b.status AS booking_status,
                b.equipment_id,
                o.user_id AS owner_user_id,
                fu.email AS farmer_email,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE bp.id = ?
             FOR UPDATE`,
            [paymentId]
        );

        if (payments.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = payments[0];

        // Authorization check: Only authorized owner of this booking can reject
        if (payment.owner_user_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "You are not authorized to reject payment for this booking"
            });
        }

        if (payment.status !== "PAYMENT_PENDING") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Only pending payments can be rejected"
            });
        }

        if (payment.booking_status !== "ACCEPTED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Booking is not in accepted status"
            });
        }

        await connection.query(
            "SELECT id FROM bookings WHERE id = ? FOR UPDATE",
            [payment.booking_id]
        );

        // Update payment status and initiate refund requirements
        await connection.query(
            `UPDATE booking_payments
             SET status = 'PAYMENT_REJECTED',
                 rejection_reason = ?,
                 refund_status = 'REFUND_REQUIRED',
                 refund_required_at = NOW(),
                 refund_deadline = DATE_ADD(NOW(), INTERVAL 24 HOUR)
             WHERE id = ?`,
            [reason.trim(), paymentId]
        );

        // Update booking status
        await connection.query(
            `UPDATE bookings
             SET status = 'CANCELLED',
                 cancellation_reason = ?
             WHERE id = ?`,
            [`Payment rejected: ${reason.trim()}`, payment.booking_id]
        );

        // Release equipment if no other active booking
        const [activeBookings] = await connection.query(
            `SELECT id FROM bookings
             WHERE equipment_id = ?
             AND status IN ('ACCEPTED', 'CONFIRMED', 'IN_PROGRESS')
             AND id != ?`,
            [payment.equipment_id, payment.booking_id]
        );

        if (activeBookings.length === 0) {
            await connection.query(
                `UPDATE equipment
                 SET status = 'AVAILABLE'
                 WHERE id = ? AND status = 'BOOKED'`,
                [payment.equipment_id]
            );
        }

        await connection.commit();

        // Send Email to Farmer (Event 8, non-blocking)
        sendPaymentRejectedEmail({
            farmerEmail: payment.farmer_email,
            farmerName: payment.farmer_name,
            bookingId: payment.booking_id,
            amount: payment.amount,
            reason: reason.trim()
        }).catch(err => console.error("Payment rejected email error:", err));

        return res.status(200).json({
            success: true,
            message: "Payment rejected successfully. Refund required within 24 hours.",
            data: {
                paymentId: Number(paymentId),
                bookingId: payment.booking_id,
                paymentStatus: "PAYMENT_REJECTED",
                refundStatus: "REFUND_REQUIRED",
                reason: reason.trim()
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Reject payment error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to reject payment"
        });
    } finally {
        connection.release();
    }
};

/**
 * Initiates/submits refund details for a rejected payment.
 * Protected with MySQL transactions and SELECT ... FOR UPDATE row locking.
 * Access: Authorized OWNER, AREA_ADMIN (in area), SUPER_ADMIN.
 */
export const submitRefund = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { paymentId } = req.params;
        const { refund_transaction_id } = req.body;

        if (!refund_transaction_id || refund_transaction_id.trim() === "") {
            return res.status(400).json({
                success: false,
                message: "Refund transaction ID is required"
            });
        }

        await connection.beginTransaction();

        const [payments] = await connection.query(
            `SELECT
                bp.id,
                bp.booking_id,
                bp.amount,
                bp.status,
                bp.refund_status,
                bp.refund_deadline,
                (bp.refund_deadline > NOW()) AS refund_window_open,
                o.user_id AS owner_user_id,
                e.location_id,
                fu.email AS farmer_email,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             WHERE bp.id = ?
             FOR UPDATE`,
            [paymentId]
        );

        if (payments.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = payments[0];
        const user = req.user;

        // Role-based Access Control
        if (user.role === "OWNER") {
            if (payment.owner_user_id !== user.id) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: "You are not authorized to submit refund for this payment"
                });
            }
            if (!payment.refund_window_open) {
                await connection.rollback();
                return res.status(400).json({
                    success: false,
                    message: "Refund deadline has expired. Area Admin will handle the refund."
                });
            }
        } else if (user.role === "AREA_ADMIN") {
            if (!user.location_id || payment.location_id !== user.location_id) {
                await connection.rollback();
                return res.status(403).json({
                    success: false,
                    message: "Area Admin can only manage refunds within their assigned area"
                });
            }
        } else if (user.role !== "SUPER_ADMIN") {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "You are not authorized to perform this action"
            });
        }

        if (payment.status !== "PAYMENT_REJECTED" && payment.refund_status !== "REFUND_REQUIRED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund can only be submitted for a rejected payment requiring refund"
            });
        }

        if (payment.refund_status === "REFUND_SUBMITTED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund has already been submitted and is awaiting farmer confirmation"
            });
        }

        if (payment.refund_status === "REFUNDED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund has already been completed"
            });
        }

        if (payment.refund_status !== "REFUND_REQUIRED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund is not currently required"
            });
        }

        await connection.query(
            `UPDATE booking_payments
             SET refund_status = 'REFUND_SUBMITTED',
                 refund_transaction_id = ?,
                 refund_submitted_at = NOW(),
                 farmer_refund_response_deadline = DATE_ADD(NOW(), INTERVAL 24 HOUR)
             WHERE id = ?`,
            [
                refund_transaction_id.trim(),
                paymentId
            ]
        );

        const [updatedRows] = await connection.query(
            `SELECT
                id,
                booking_id,
                amount,
                refund_status,
                refund_transaction_id,
                refund_submitted_at,
                farmer_refund_response_deadline
             FROM booking_payments
             WHERE id = ?`,
            [paymentId]
        );

        await connection.commit();

        // Send Email to Farmer (Event 9, non-blocking)
        sendRefundInitiatedEmail({
            farmerEmail: payment.farmer_email,
            farmerName: payment.farmer_name,
            bookingId: payment.booking_id,
            amount: payment.amount,
            refundTransactionId: refund_transaction_id.trim()
        }).catch(err => console.error("Refund initiated email error:", err));

        const updatedPayment = updatedRows[0];

        return res.status(200).json({
            success: true,
            message: "Refund submitted successfully. Farmer has 24 hours to confirm receipt.",
            data: {
                paymentId: Number(paymentId),
                bookingId: updatedPayment.booking_id,
                refundAmount: Number(updatedPayment.amount),
                refundTransactionId: updatedPayment.refund_transaction_id,
                refundSubmittedAt: updatedPayment.refund_submitted_at,
                farmerResponseDeadline: updatedPayment.farmer_refund_response_deadline,
                refundStatus: updatedPayment.refund_status
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Submit refund error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to submit refund"
        });
    } finally {
        connection.release();
    }
};

/**
 * Farmer confirms receipt of refund.
 * Protected with MySQL transactions and row locking.
 * Access: Authenticated FARMER associated with the booking.
 */
export const confirmRefund = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { paymentId } = req.params;

        await connection.beginTransaction();

        const [payments] = await connection.query(
            `SELECT
                bp.id,
                bp.booking_id,
                bp.amount,
                bp.refund_status,
                bp.refund_submitted_at,
                bp.farmer_refund_response_deadline,
                f.user_id AS farmer_user_id,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name,
                ou.phone AS owner_phone,
                ou.full_name AS owner_name
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             WHERE bp.id = ?
             FOR UPDATE`,
            [paymentId]
        );

        if (payments.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = payments[0];

        // Authorization check: Only associated farmer can confirm refund
        if (payment.farmer_user_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "You are not authorized to confirm refund for this booking"
            });
        }

        // Prevent confirming a refund before it has been initiated
        if (payment.refund_status === "NOT_REQUIRED" || payment.refund_status === "REFUND_REQUIRED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund has not been initiated by the owner"
            });
        }

        // Prevent confirming the same refund multiple times
        if (payment.refund_status === "REFUNDED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund has already been confirmed"
            });
        }

        if (payment.refund_status === "REFUND_DISPUTED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund is currently under dispute and cannot be directly confirmed"
            });
        }

        if (payment.refund_status !== "REFUND_SUBMITTED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund is not awaiting farmer confirmation"
            });
        }

        // Correct deadline comparison: If current time is past the response deadline,
        // the farmer can no longer confirm directly as it has escalated to Area Admin.
        if (
            payment.farmer_refund_response_deadline &&
            new Date() > new Date(payment.farmer_refund_response_deadline)
        ) {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund confirmation deadline has expired. This case has been escalated to Area Admin."
            });
        }

        await connection.query(
            `UPDATE booking_payments
             SET refund_status = 'REFUNDED',
                 refund_verified_at = NOW()
             WHERE id = ?`,
            [paymentId]
        );

        // Synchronize and close any associated dispute in refund_disputes
        const [linkedDisputes] = await connection.query(
            `SELECT id, status, resolution_outcome 
             FROM refund_disputes 
             WHERE payment_id = ? OR booking_id = ?`,
            [paymentId, payment.booking_id]
        );

        for (const ld of linkedDisputes) {
            if (ld.status !== "CLOSED") {
                await connection.query(
                    `UPDATE refund_disputes
                     SET status = 'CLOSED',
                         resolution_outcome = COALESCE(resolution_outcome, 'REFUND_CONFIRMED'),
                         resolved_at = COALESCE(resolved_at, NOW()),
                         admin_notes = CONCAT(COALESCE(admin_notes, ''), '\n[', NOW(), ' Farmer Refund Confirmed]: Farmer confirmed receipt of refund. Case formally closed.')
                     WHERE id = ?`,
                    [ld.id]
                );
            }
        }

        const [updatedRows] = await connection.query(
            `SELECT
                id,
                booking_id,
                amount,
                refund_status,
                refund_submitted_at,
                refund_verified_at
             FROM booking_payments
             WHERE id = ?`,
            [paymentId]
        );

        await connection.commit();

        const updatedPayment = updatedRows[0];

        return res.status(200).json({
            success: true,
            message: "Refund confirmed successfully",
            data: {
                paymentId: Number(paymentId),
                bookingId: updatedPayment.booking_id,
                refundAmount: Number(updatedPayment.amount),
                refundStatus: updatedPayment.refund_status,
                refundSubmittedAt: updatedPayment.refund_submitted_at,
                refundVerifiedAt: updatedPayment.refund_verified_at
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Confirm refund error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to confirm refund"
        });
    } finally {
        connection.release();
    }
};

/**
 * Farmer disputes a submitted refund (money not received).
 * Protected with MySQL transactions and row locking.
 * Access: Authenticated FARMER associated with the booking.
 */
export const disputeRefund = async (req, res) => {
    const connection = await pool.getConnection();
    try {
        const { paymentId } = req.params;
        const { reason } = req.body;

        if (!reason || !reason.trim()) {
            return res.status(400).json({
                success: false,
                message: "Dispute reason is required"
            });
        }

        await connection.beginTransaction();

        const [payments] = await connection.query(
            `SELECT
                bp.id,
                bp.booking_id,
                bp.amount,
                bp.refund_status,
                bp.refund_submitted_at,
                f.user_id AS farmer_user_id,
                e.location_id,
                ou.email AS owner_email,
                ou.phone AS owner_phone,
                ou.full_name AS owner_name,
                fu.email AS farmer_email,
                fu.phone AS farmer_phone,
                fu.full_name AS farmer_name
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             WHERE bp.id = ?
             FOR UPDATE`,
            [paymentId]
        );

        if (payments.length === 0) {
            await connection.rollback();
            return res.status(404).json({
                success: false,
                message: "Payment not found"
            });
        }

        const payment = payments[0];

        // Authorization check: Only associated farmer can raise dispute
        if (payment.farmer_user_id !== req.user.id) {
            await connection.rollback();
            return res.status(403).json({
                success: false,
                message: "You are not authorized to dispute refund for this booking"
            });
        }

        if (payment.refund_status === "REFUNDED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Cannot dispute an already confirmed refund"
            });
        }

        if (payment.refund_status === "REFUND_DISPUTED") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund dispute has already been submitted for this payment"
            });
        }

        if (payment.refund_status !== "REFUND_SUBMITTED" && payment.refund_status !== "REFUND_OUTSTANDING") {
            await connection.rollback();
            return res.status(400).json({
                success: false,
                message: "Refund is not available for dispute"
            });
        }

        // Update payment status
        await connection.query(
            `UPDATE booking_payments
             SET refund_status = 'REFUND_DISPUTED',
                 refund_dispute_reason = ?
             WHERE id = ?`,
            [reason.trim(), paymentId]
        );

        // Find assigned Area Admin for the booking/equipment location
        const [adminRows] = await connection.query(
            `SELECT aa.id, aa.user_id, u.email AS admin_email, u.phone AS admin_phone, u.full_name AS admin_name
             FROM area_admins aa
             JOIN users u ON aa.user_id = u.id
             WHERE aa.location_id = ?
             LIMIT 1`,
            [payment.location_id]
        );

        const assignedAreaAdminId = adminRows.length > 0 ? adminRows[0].id : null;
        const adminData = adminRows.length > 0 ? adminRows[0] : null;

        // Prevent duplicate dispute records
        const [existingDisputes] = await connection.query(
            `SELECT id FROM refund_disputes WHERE payment_id = ? FOR UPDATE`,
            [paymentId]
        );

        let disputeId;
        if (existingDisputes.length === 0) {
            const [disputeResult] = await connection.query(
                `INSERT INTO refund_disputes
                    (payment_id, booking_id, dispute_reason, dispute_category, raised_by_user_id, raised_by_role, status, assigned_area_admin_id)
                 VALUES (?, ?, ?, 'REFUND_NOT_RECEIVED', ?, 'FARMER', 'OPEN', ?)`,
                [
                    paymentId,
                    payment.booking_id,
                    reason.trim(),
                    req.user.id,
                    assignedAreaAdminId
                ]
            );
            disputeId = disputeResult.insertId;
        } else {
            disputeId = existingDisputes[0].id;
        }

        await connection.commit();

        // Send notifications (Event 11 & 12, non-blocking via Brevo Email)
        sendRefundDisputeEmail({
            recipientEmail: payment.farmer_email,
            recipientName: payment.farmer_name,
            bookingId: payment.booking_id,
            disputeReason: reason.trim()
        }).catch(err => console.error("Dispute farmer email error:", err));

        sendRefundDisputeEmail({
            recipientEmail: payment.owner_email,
            recipientName: payment.owner_name,
            bookingId: payment.booking_id,
            disputeReason: reason.trim()
        }).catch(err => console.error("Dispute owner email error:", err));

        if (adminData && adminData.admin_email) {
            sendAreaAdminDisputeEmail({
                adminEmail: adminData.admin_email,
                adminName: adminData.admin_name,
                bookingId: payment.booking_id,
                disputeId,
                disputeReason: reason.trim()
            }).catch(err => console.error("Dispute area admin email error:", err));
        }

        return res.status(200).json({
            success: true,
            message: "Refund dispute submitted successfully",
            data: {
                disputeId,
                paymentId: Number(paymentId),
                bookingId: payment.booking_id,
                refundAmount: Number(payment.amount),
                disputeReason: reason.trim(),
                refundStatus: "REFUND_DISPUTED",
                disputedAt: new Date()
            }
        });

    } catch (error) {
        await connection.rollback();
        console.error("Dispute refund error:", error.message || error);
        return res.status(500).json({
            success: false,
            message: "Failed to submit refund dispute"
        });
    } finally {
        connection.release();
    }
};

export const getPaymentById = async (req, res) => {
    try {
        const { paymentId } = req.params;
        const [rows] = await pool.query(
            `SELECT 
                bp.id AS payment_id,
                bp.booking_id,
                bp.amount,
                bp.payment_method,
                bp.transaction_id,
                bp.status AS payment_status,
                bp.verification_deadline,
                bp.verified_at,
                bp.auto_rejected_at,
                bp.rejection_reason,
                bp.refund_status,
                bp.refund_fine_amount,
                bp.refund_transaction_id,
                bp.refund_submitted_at,
                bp.refund_verified_at,
                bp.submitted_at,

                b.start_date,
                b.end_date,
                b.status AS booking_status,
                b.total_amount AS booking_total_amount,
                b.advance_amount AS booking_advance_amount,

                e.id AS equipment_id,
                e.name AS equipment_name,
                e.location_id AS equipment_location_id,

                f.id AS farmer_id,
                f.user_id AS farmer_user_id,
                f.location_id AS farmer_location_id,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone,
                fu.email AS farmer_email,

                o.id AS owner_id,
                o.user_id AS owner_user_id,
                o.location_id AS owner_location_id,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                ou.email AS owner_email

             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             WHERE bp.id = ?`,
            [paymentId]
        );

        if (rows.length === 0) {
            return res.status(404).json({ success: false, message: "Payment not found" });
        }

        const payment = rows[0];
        const { role, id: userId, location_id: adminLocationId } = req.user;

        // RBAC & Ownership check
        if (role === "FARMER" && payment.farmer_user_id !== userId) {
            return res.status(403).json({ success: false, message: "You are not authorized to view this payment" });
        }
        if (role === "OWNER" && payment.owner_user_id !== userId) {
            return res.status(403).json({ success: false, message: "You are not authorized to view this payment" });
        }
        if (role === "AREA_ADMIN") {
            const matchesArea = (
                !adminLocationId ||
                payment.equipment_location_id === adminLocationId ||
                payment.farmer_location_id === adminLocationId ||
                payment.owner_location_id === adminLocationId
            );
            if (!matchesArea) {
                return res.status(403).json({ success: false, message: "You are not authorized to view payments outside your assigned area" });
            }
        } else if (role !== "SUPER_ADMIN" && role !== "FARMER" && role !== "OWNER") {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        const {
            farmer_user_id,
            owner_user_id,
            equipment_location_id,
            farmer_location_id,
            owner_location_id,
            ...paymentData
        } = payment;

        return res.status(200).json({ success: true, data: paymentData });
    } catch (error) {
        console.error("Get payment by ID error:", error.message || error);
        return res.status(500).json({ success: false, message: "Failed to retrieve payment details" });
    }
};

export const getBookingPayments = async (req, res) => {
    try {
        const { bookingId } = req.params;
        const [bookingRows] = await pool.query(
            `SELECT 
                b.id,
                f.user_id AS farmer_user_id,
                f.location_id AS farmer_location_id,
                o.user_id AS owner_user_id,
                o.location_id AS owner_location_id,
                e.location_id AS equipment_location_id
             FROM bookings b
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN owners o ON e.owner_id = o.id
             WHERE b.id = ?`,
            [bookingId]
        );

        if (bookingRows.length === 0) {
            return res.status(404).json({ success: false, message: "Booking not found" });
        }

        const booking = bookingRows[0];
        const { role, id: userId, location_id: adminLocationId } = req.user;

        if (role === "FARMER" && booking.farmer_user_id !== userId) {
            return res.status(403).json({ success: false, message: "You are not authorized to view payments for this booking" });
        }
        if (role === "OWNER" && booking.owner_user_id !== userId) {
            return res.status(403).json({ success: false, message: "You are not authorized to view payments for this booking" });
        }
        if (role === "AREA_ADMIN") {
            const matchesArea = (
                !adminLocationId ||
                booking.equipment_location_id === adminLocationId ||
                booking.farmer_location_id === adminLocationId ||
                booking.owner_location_id === adminLocationId
            );
            if (!matchesArea) {
                return res.status(403).json({ success: false, message: "You are not authorized to view payments outside your assigned area" });
            }
        } else if (role !== "SUPER_ADMIN" && role !== "FARMER" && role !== "OWNER") {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        const [payments] = await pool.query(
            `SELECT 
                bp.id AS payment_id,
                bp.booking_id,
                bp.amount,
                bp.payment_method,
                bp.transaction_id,
                bp.status AS payment_status,
                bp.verification_deadline,
                bp.verified_at,
                bp.auto_rejected_at,
                bp.rejection_reason,
                bp.refund_status,
                bp.refund_fine_amount,
                bp.refund_transaction_id,
                bp.refund_submitted_at,
                bp.refund_verified_at,
                bp.submitted_at
             FROM booking_payments bp
             WHERE bp.booking_id = ?
             ORDER BY bp.submitted_at DESC`,
            [bookingId]
        );

        return res.status(200).json({ success: true, count: payments.length, data: payments });
    } catch (error) {
        console.error("Get booking payments error:", error.message || error);
        return res.status(500).json({ success: false, message: "Failed to retrieve booking payments" });
    }
};

export const getFarmerPayments = async (req, res) => {
    try {
        const [farmerRows] = await pool.query("SELECT id FROM farmers WHERE user_id = ?", [req.user.id]);
        if (farmerRows.length === 0) {
            return res.status(404).json({ success: false, message: "Farmer profile not found" });
        }
        const farmerId = farmerRows[0].id;
        const { status, booking_id, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const conditions = ["b.farmer_id = ?"];
        const params = [farmerId];

        if (status) {
            conditions.push("bp.status = ?");
            params.push(status);
        }
        if (booking_id) {
            conditions.push("bp.booking_id = ?");
            params.push(booking_id);
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const [countResult] = await pool.query(
            `SELECT COUNT(bp.id) AS total
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             ${whereClause}`,
            params
        );
        const total = countResult[0].total;

        const [payments] = await pool.query(
            `SELECT 
                bp.id AS payment_id,
                bp.booking_id,
                bp.amount,
                bp.payment_method,
                bp.transaction_id,
                bp.status AS payment_status,
                bp.verification_deadline,
                bp.verified_at,
                bp.auto_rejected_at,
                bp.rejection_reason,
                bp.refund_status,
                bp.refund_fine_amount,
                bp.refund_transaction_id,
                bp.refund_submitted_at,
                bp.refund_verified_at,
                bp.submitted_at,
                e.name AS equipment_name,
                ou.full_name AS owner_name
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             ${whereClause}
             ORDER BY bp.submitted_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        return res.status(200).json({
            success: true,
            pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
            count: payments.length,
            data: payments
        });
    } catch (error) {
        console.error("Get farmer payments error:", error.message || error);
        return res.status(500).json({ success: false, message: "Failed to retrieve farmer payments" });
    }
};

export const getOwnerPayments = async (req, res) => {
    try {
        const [ownerRows] = await pool.query("SELECT id FROM owners WHERE user_id = ?", [req.user.id]);
        if (ownerRows.length === 0) {
            return res.status(404).json({ success: false, message: "Owner profile not found" });
        }
        const ownerId = ownerRows[0].id;
        const { status, booking_id, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const conditions = ["e.owner_id = ?"];
        const params = [ownerId];

        if (status) {
            conditions.push("bp.status = ?");
            params.push(status);
        }
        if (booking_id) {
            conditions.push("bp.booking_id = ?");
            params.push(booking_id);
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const [countResult] = await pool.query(
            `SELECT COUNT(bp.id) AS total
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             ${whereClause}`,
            params
        );
        const total = countResult[0].total;

        const [payments] = await pool.query(
            `SELECT 
                bp.id AS payment_id,
                bp.booking_id,
                bp.amount,
                bp.payment_method,
                bp.transaction_id,
                bp.status AS payment_status,
                bp.verification_deadline,
                bp.verified_at,
                bp.auto_rejected_at,
                bp.rejection_reason,
                bp.refund_status,
                bp.refund_fine_amount,
                bp.refund_transaction_id,
                bp.refund_submitted_at,
                bp.refund_verified_at,
                bp.submitted_at,
                e.name AS equipment_name,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             ${whereClause}
             ORDER BY bp.submitted_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        return res.status(200).json({
            success: true,
            pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
            count: payments.length,
            data: payments
        });
    } catch (error) {
        console.error("Get owner payments error:", error.message || error);
        return res.status(500).json({ success: false, message: "Failed to retrieve owner payments" });
    }
};

export const getRefunds = async (req, res) => {
    try {
        const { role, id: userId, location_id: adminLocationId } = req.user;
        const { refund_status, page = 1, limit = 20 } = req.query;

        const pageNum = Math.max(1, parseInt(page, 10) || 1);
        const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
        const offset = (pageNum - 1) * limitNum;

        const conditions = ["bp.refund_status IS NOT NULL"];
        const params = [];

        if (role === "OWNER") {
            const [ownerRows] = await pool.query("SELECT id FROM owners WHERE user_id = ?", [userId]);
            if (ownerRows.length === 0) {
                return res.status(404).json({ success: false, message: "Owner profile not found" });
            }
            conditions.push("e.owner_id = ?");
            params.push(ownerRows[0].id);
        } else if (role === "FARMER") {
            const [farmerRows] = await pool.query("SELECT id FROM farmers WHERE user_id = ?", [userId]);
            if (farmerRows.length === 0) {
                return res.status(404).json({ success: false, message: "Farmer profile not found" });
            }
            conditions.push("b.farmer_id = ?");
            params.push(farmerRows[0].id);
        } else if (role === "AREA_ADMIN") {
            if (adminLocationId) {
                conditions.push("(e.location_id = ? OR f.location_id = ?)");
                params.push(adminLocationId, adminLocationId);
            }
        } else if (role !== "SUPER_ADMIN") {
            return res.status(403).json({ success: false, message: "Unauthorized" });
        }

        if (refund_status) {
            conditions.push("bp.refund_status = ?");
            params.push(refund_status);
        }

        const whereClause = `WHERE ${conditions.join(" AND ")}`;

        const [countResult] = await pool.query(
            `SELECT COUNT(bp.id) AS total
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             ${whereClause}`,
            params
        );
        const total = countResult[0].total;

        const [refunds] = await pool.query(
            `SELECT 
                bp.id AS payment_id,
                bp.booking_id,
                bp.amount,
                bp.refund_status,
                bp.refund_fine_amount,
                bp.refund_transaction_id,
                bp.refund_required_at,
                bp.refund_deadline,
                bp.refund_submitted_at,
                bp.refund_verified_at,
                bp.rejection_reason,
                e.id AS equipment_id,
                e.name AS equipment_name,
                fu.full_name AS farmer_name,
                fu.phone AS farmer_phone,
                fu.email AS farmer_email,
                ou.full_name AS owner_name,
                ou.phone AS owner_phone,
                ou.email AS owner_email
             FROM booking_payments bp
             JOIN bookings b ON bp.booking_id = b.id
             JOIN equipment e ON b.equipment_id = e.id
             JOIN farmers f ON b.farmer_id = f.id
             JOIN users fu ON f.user_id = fu.id
             JOIN owners o ON e.owner_id = o.id
             JOIN users ou ON o.user_id = ou.id
             ${whereClause}
             ORDER BY bp.refund_required_at DESC, bp.submitted_at DESC
             LIMIT ? OFFSET ?`,
            [...params, limitNum, offset]
        );

        return res.status(200).json({
            success: true,
            pagination: { page: pageNum, limit: limitNum, total, totalPages: Math.ceil(total / limitNum) },
            count: refunds.length,
            data: refunds
        });
    } catch (error) {
        console.error("Get refunds error:", error.message || error);
        return res.status(500).json({ success: false, message: "Failed to retrieve refunds" });
    }
};
