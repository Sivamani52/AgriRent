import pool from "../db.js";

/**
 * Create a new equipment category
 * POST /api/equipment-categories
 */
export const createEquipmentCategory = async (req, res) => {
    try {
        const { name, description } = req.body;

        if (!name || typeof name !== "string" || !name.trim()) {
            return res.status(400).json({
                success: false,
                message: "Category name is required"
            });
        }

        const trimmedName = name.trim();

        if (trimmedName.length > 100) {
            return res.status(400).json({
                success: false,
                message: "Category name must not exceed 100 characters"
            });
        }

        const trimmedDescription =
            description !== undefined && description !== null
                ? String(description).trim()
                : null;

        if (trimmedDescription && trimmedDescription.length > 255) {
            return res.status(400).json({
                success: false,
                message: "Category description must not exceed 255 characters"
            });
        }

        const [existingCategory] = await pool.query(
            `SELECT id
             FROM equipment_categories
             WHERE LOWER(name) = LOWER(?)`,
            [trimmedName]
        );

        if (existingCategory.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Equipment category already exists"
            });
        }

        const [result] = await pool.query(
            `INSERT INTO equipment_categories
            (name, description, status)
            VALUES (?, ?, 'ACTIVE')`,
            [
                trimmedName,
                trimmedDescription || null
            ]
        );

        const [newCategory] = await pool.query(
            `SELECT
                id,
                name,
                description,
                status,
                created_at,
                updated_at
             FROM equipment_categories
             WHERE id = ?`,
            [result.insertId]
        );

        return res.status(201).json({
            success: true,
            message: "Equipment category created successfully",
            data: {
                ...newCategory[0],
                categoryId: result.insertId
            }
        });

    } catch (error) {
        console.error(
            "Create equipment category error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to create equipment category"
        });
    }
};

/**
 * Get all equipment categories
 * GET /api/equipment-categories
 * Query params: status (optional, default 'ACTIVE', or 'ALL', 'INACTIVE'), search (optional)
 */
export const getEquipmentCategories = async (req, res) => {
    try {
        const { status, search } = req.query;

        let query = `
            SELECT
                id,
                name,
                description,
                status,
                created_at,
                updated_at
             FROM equipment_categories
             WHERE 1=1
        `;
        const values = [];

        if (status && status.toUpperCase() !== "ALL") {
            const allowedStatuses = ["ACTIVE", "INACTIVE"];
            const upperStatus = status.toUpperCase();
            if (allowedStatuses.includes(upperStatus)) {
                query += ` AND status = ?`;
                values.push(upperStatus);
            }
        } else if (!status) {
            query += ` AND status = 'ACTIVE'`;
        }

        if (search && search.trim()) {
            query += ` AND (name LIKE ? OR description LIKE ?)`;
            const searchPattern = `%${search.trim()}%`;
            values.push(searchPattern, searchPattern);
        }

        query += ` ORDER BY name ASC`;

        const [categories] = await pool.query(query, values);

        return res.status(200).json({
            success: true,
            message: "Equipment categories fetched successfully",
            count: categories.length,
            data: categories
        });

    } catch (error) {
        console.error(
            "Get equipment categories error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to fetch equipment categories"
        });
    }
};

/**
 * Get a single equipment category by ID
 * GET /api/equipment-categories/:categoryId
 */
export const getEquipmentCategoryById = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const categoryIdNumber = Number(categoryId);

        if (!Number.isInteger(categoryIdNumber) || categoryIdNumber <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID"
            });
        }

        const [categories] = await pool.query(
            `SELECT
                id,
                name,
                description,
                status,
                created_at,
                updated_at
             FROM equipment_categories
             WHERE id = ?`,
            [categoryIdNumber]
        );

        if (categories.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment category not found"
            });
        }

        return res.status(200).json({
            success: true,
            message: "Equipment category fetched successfully",
            data: categories[0]
        });

    } catch (error) {
        console.error(
            "Get equipment category details error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to fetch equipment category details"
        });
    }
};

/**
 * Update an existing equipment category
 * PUT /api/equipment-categories/:categoryId
 * PATCH /api/equipment-categories/:categoryId
 */
export const updateEquipmentCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const categoryIdNumber = Number(categoryId);

        if (!Number.isInteger(categoryIdNumber) || categoryIdNumber <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID"
            });
        }

        const {
            name,
            description,
            status
        } = req.body;

        const [category] = await pool.query(
            `SELECT id
             FROM equipment_categories
             WHERE id = ?`,
            [categoryIdNumber]
        );

        if (category.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment category not found"
            });
        }

        if (
            name === undefined &&
            description === undefined &&
            status === undefined
        ) {
            return res.status(400).json({
                success: false,
                message: "At least one category field is required"
            });
        }

        let trimmedName;
        if (name !== undefined) {
            if (typeof name !== "string" || !name.trim()) {
                return res.status(400).json({
                    success: false,
                    message: "Category name cannot be empty"
                });
            }
            trimmedName = name.trim();
            if (trimmedName.length > 100) {
                return res.status(400).json({
                    success: false,
                    message: "Category name must not exceed 100 characters"
                });
            }

            const [existingCategory] = await pool.query(
                `SELECT id
                 FROM equipment_categories
                 WHERE LOWER(name) = LOWER(?)
                 AND id != ?`,
                [trimmedName, categoryIdNumber]
            );

            if (existingCategory.length > 0) {
                return res.status(409).json({
                    success: false,
                    message: "Equipment category already exists"
                });
            }
        }

        let trimmedDescription;
        if (description !== undefined) {
            trimmedDescription =
                description !== null ? String(description).trim() : null;
            if (trimmedDescription && trimmedDescription.length > 255) {
                return res.status(400).json({
                    success: false,
                    message: "Category description must not exceed 255 characters"
                });
            }
        }

        if (status !== undefined) {
            const allowedStatuses = ["ACTIVE", "INACTIVE"];
            if (!allowedStatuses.includes(status)) {
                return res.status(400).json({
                    success: false,
                    message: "Invalid category status. Must be ACTIVE or INACTIVE"
                });
            }
        }

        const fields = [];
        const values = [];

        if (trimmedName !== undefined) {
            fields.push("name = ?");
            values.push(trimmedName);
        }

        if (description !== undefined) {
            fields.push("description = ?");
            values.push(trimmedDescription || null);
        }

        if (status !== undefined) {
            fields.push("status = ?");
            values.push(status);
        }

        if (fields.length === 0) {
            return res.status(400).json({
                success: false,
                message: "No valid fields provided for update"
            });
        }

        values.push(categoryIdNumber);

        await pool.query(
            `UPDATE equipment_categories
             SET ${fields.join(", ")}
             WHERE id = ?`,
            values
        );

        const [updatedCategory] = await pool.query(
            `SELECT
                id,
                name,
                description,
                status,
                created_at,
                updated_at
             FROM equipment_categories
             WHERE id = ?`,
            [categoryIdNumber]
        );

        return res.status(200).json({
            success: true,
            message: "Equipment category updated successfully",
            data: updatedCategory[0]
        });

    } catch (error) {
        console.error(
            "Update equipment category error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to update equipment category"
        });
    }
};

/**
 * Delete an equipment category
 * DELETE /api/equipment-categories/:categoryId
 */
export const deleteEquipmentCategory = async (req, res) => {
    try {
        const { categoryId } = req.params;
        const categoryIdNumber = Number(categoryId);

        if (!Number.isInteger(categoryIdNumber) || categoryIdNumber <= 0) {
            return res.status(400).json({
                success: false,
                message: "Invalid category ID"
            });
        }

        const [category] = await pool.query(
            `SELECT id, name
             FROM equipment_categories
             WHERE id = ?`,
            [categoryIdNumber]
        );

        if (category.length === 0) {
            return res.status(404).json({
                success: false,
                message: "Equipment category not found"
            });
        }

        // Check if any equipment is currently using this category
        const [associatedEquipment] = await pool.query(
            `SELECT id
             FROM equipment
             WHERE equipment_type = ?
             LIMIT 1`,
            [category[0].name]
        );

        if (associatedEquipment.length > 0) {
            return res.status(409).json({
                success: false,
                message: "Cannot delete category as it is currently assigned to existing equipment. Consider deactivating it instead."
            });
        }

        await pool.query(
            `DELETE FROM equipment_categories
             WHERE id = ?`,
            [categoryIdNumber]
        );

        return res.status(200).json({
            success: true,
            message: "Equipment category deleted successfully",
            data: {
                categoryId: categoryIdNumber
            }
        });

    } catch (error) {
        console.error(
            "Delete equipment category error:",
            error.message || error
        );

        return res.status(500).json({
            success: false,
            message: "Failed to delete equipment category"
        });
    }
};