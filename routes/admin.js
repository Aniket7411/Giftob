const express = require('express');
const { body, validationResult } = require('express-validator');
const User = require('../models/User');
const Seller = require('../models/Seller');
const Gift = require('../models/Gift');
const Order = require('../models/Order');
const { protect } = require('../middleware/auth');
const { checkRole } = require('../middleware/role');

const router = express.Router();

// @route   GET /api/admin/sellers
// @desc    Get all sellers with stats
// @access  Private (Admin only)
router.get('/sellers', protect, checkRole('admin'), async (req, res) => {
    try {
        const { page = 1, limit = 20, search, status } = req.query;

        // Build filter
        const filter = {};
        if (search) {
            filter.$or = [
                { fullName: { $regex: search, $options: 'i' } },
                { email: { $regex: search, $options: 'i' } },
                { shopName: { $regex: search, $options: 'i' } }
            ];
        }
        if (status === 'verified') {
            filter.isVerified = true;
        } else if (status === 'unverified') {
            filter.isVerified = false;
        }

        // Calculate pagination
        const skip = (parseInt(page) - 1) * parseInt(limit);

        // Get sellers
        const sellers = await Seller.find(filter)
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        // Get stats for each seller
        const sellersWithStats = await Promise.all(
            sellers.map(async (seller) => {
                const totalGifts = await Gift.countDocuments({ seller: seller.user });

                const orders = await Order.aggregate([
                    {
                        $match: { 'items.seller': seller.user }
                    },
                    {
                        $group: {
                            _id: null,
                            count: { $sum: 1 },
                            revenue: { $sum: '$totalPrice' }
                        }
                    }
                ]);

                return {
                    _id: seller._id,
                    fullName: seller.fullName,
                    email: seller.email,
                    phone: seller.phone,
                    shopName: seller.shopName,
                    shopType: seller.shopType,
                    isVerified: seller.isVerified,
                    totalGifts,
                    totalGems: totalGifts,
                    totalOrders: orders[0]?.count || 0,
                    totalRevenue: orders[0]?.revenue || 0,
                    createdAt: seller.createdAt
                };
            })
        );

        // Get total count
        const count = await Seller.countDocuments(filter);
        const totalPages = Math.ceil(count / parseInt(limit));

        res.json({
            success: true,
            count,
            totalPages,
            currentPage: parseInt(page),
            sellers: sellersWithStats
        });

    } catch (error) {
        console.error('Get sellers error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during sellers retrieval'
        });
    }
});

// @route   GET /api/admin/sellers/:sellerId
// @desc    Get seller details with gems and orders
// @access  Private (Admin only)
router.get('/sellers/:sellerId', protect, checkRole('admin'), async (req, res) => {
    try {
        const seller = await Seller.findById(req.params.sellerId);

        if (!seller) {
            return res.status(404).json({
                success: false,
                message: 'Seller not found'
            });
        }

        // Get seller's gifts
        const gifts = await Gift.find({ seller: seller.user })
            .select('name category price finalPrice discount discountType stock availability createdAt')
            .sort({ createdAt: -1 })
            .limit(10);

        // Get seller's orders
        const orders = await Order.find({ 'items.seller': seller.user })
            .select('orderNumber totalPrice status createdAt')
            .sort({ createdAt: -1 })
            .limit(10);

        // Get stats
        const totalGifts = await Gift.countDocuments({ seller: seller.user });
        const orderStats = await Order.aggregate([
            {
                $match: { 'items.seller': seller.user }
            },
            {
                $group: {
                    _id: null,
                    count: { $sum: 1 },
                    revenue: { $sum: '$totalPrice' }
                }
            }
        ]);

        res.json({
            success: true,
            seller: {
                ...seller.toObject(),
                gifts,
                orders,
                stats: {
                    totalGems: totalGifts,
                    totalGifts,
                    totalOrders: orderStats[0]?.count || 0,
                    totalRevenue: orderStats[0]?.revenue || 0,
                    averageRating: 4.5 // Placeholder
                }
            }
        });

    } catch (error) {
        console.error('Get seller details error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during seller details retrieval'
        });
    }
});

// @route   PUT /api/admin/sellers/:sellerId/verify
// @desc    Update seller verification status
// @access  Private (Admin only)
router.put('/sellers/:sellerId/verify', protect, checkRole('admin'), [
    body('isVerified').isBoolean().withMessage('isVerified must be a boolean')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { isVerified } = req.body;

        const seller = await Seller.findByIdAndUpdate(
            req.params.sellerId,
            {
                isVerified,
                status: isVerified ? 'approved' : 'pending'
            },
            { new: true }
        );

        if (!seller) {
            return res.status(404).json({
                success: false,
                message: 'Seller not found'
            });
        }

        res.json({
            success: true,
            message: 'Seller verification status updated',
            seller: {
                _id: seller._id,
                isVerified: seller.isVerified,
                status: seller.status,
                updatedAt: seller.updatedAt
            }
        });

    } catch (error) {
        console.error('Update seller verification error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during verification update'
        });
    }
});

// @route   PUT /api/admin/sellers/:sellerId/status
// @desc    Update seller status (approve/reject/suspend)
// @access  Private (Admin only)
router.put('/sellers/:sellerId/status', protect, checkRole('admin'), [
    body('status').isIn(['pending', 'approved', 'rejected', 'suspended', 'active']).withMessage('Valid status required'),
    body('suspensionReason').optional().isString().withMessage('Suspension reason must be a string')
], async (req, res) => {
    try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
            return res.status(400).json({
                success: false,
                message: 'Validation failed',
                errors: errors.array()
            });
        }

        const { status, suspensionReason } = req.body;

        const updateData = {
            status,
            isVerified: status === 'approved' || status === 'active'
        };

        if (status === 'suspended') {
            updateData.suspensionReason = suspensionReason;
            updateData.suspendedAt = new Date();
            updateData.suspendedBy = req.user._id;
        }

        const seller = await Seller.findByIdAndUpdate(
            req.params.sellerId,
            updateData,
            { new: true }
        );

        if (!seller) {
            return res.status(404).json({
                success: false,
                message: 'Seller not found'
            });
        }

        res.json({
            success: true,
            message: `Seller ${status} successfully`,
            seller
        });

    } catch (error) {
        console.error('Update seller status error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during status update'
        });
    }
});

// @route   DELETE /api/admin/sellers/:sellerId
// @desc    Delete seller and their gems
// @access  Private (Admin only)
router.delete('/sellers/:sellerId', protect, checkRole('admin'), async (req, res) => {
    try {
        const seller = await Seller.findById(req.params.sellerId);

        if (!seller) {
            return res.status(404).json({
                success: false,
                message: 'Seller not found'
            });
        }

        // Delete seller's gifts
        await Gift.deleteMany({ seller: seller.user });

        // Delete seller profile
        await Seller.findByIdAndDelete(req.params.sellerId);

        // Optionally delete user account
        await User.findByIdAndDelete(seller.user);

        res.json({
            success: true,
            message: 'Seller deleted successfully'
        });

    } catch (error) {
        console.error('Delete seller error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during seller deletion'
        });
    }
});

// @route   GET /api/admin/orders
// @desc    Get all orders (Admin)
// @access  Private (Admin only)
router.get('/orders', protect, checkRole('admin'), async (req, res) => {
    try {
        const { page = 1, limit = 20, status } = req.query;

        const filter = {};
        if (status) filter.status = status;

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const orders = await Order.find(filter)
            .populate('user', 'name email')
            .populate('items.gift', 'name')
            .populate('items.gem', 'name')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const count = await Order.countDocuments(filter);
        const totalPages = Math.ceil(count / parseInt(limit));

        res.json({
            success: true,
            count,
            totalPages,
            currentPage: parseInt(page),
            orders
        });

    } catch (error) {
        console.error('Get admin orders error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during orders retrieval'
        });
    }
});

// @route   GET /api/admin/gems
// @desc    Get all gems (Admin)
// @access  Private (Admin only)
const listGiftsHandler = async (req, res) => {
    try {
        const { page = 1, limit = 20, search } = req.query;

        const filter = {};
        if (search) {
            filter.$or = [
                { name: { $regex: search, $options: 'i' } },
                { category: { $regex: search, $options: 'i' } },
                { headline: { $regex: search, $options: 'i' } }
            ];
        }

        const skip = (parseInt(page) - 1) * parseInt(limit);

        const gifts = await Gift.find(filter)
            .populate('seller', 'name email')
            .skip(skip)
            .limit(parseInt(limit))
            .sort({ createdAt: -1 });

        const count = await Gift.countDocuments(filter);
        const totalPages = Math.ceil(count / parseInt(limit));

        res.json({
            success: true,
            count,
            totalPages,
            currentPage: parseInt(page),
            gifts,
            gems: gifts
        });

    } catch (error) {
        console.error('Get admin gems error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during gems retrieval'
        });
    }
};

router.get('/gems', protect, checkRole('admin'), listGiftsHandler);
router.get('/products', protect, checkRole('admin'), listGiftsHandler);

module.exports = router;