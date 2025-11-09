const express = require('express');
const { body, validationResult, param, query } = require('express-validator');
const mongoose = require('mongoose');
const Order = require('../models/Order');
const Gift = require('../models/Gift');
const Cart = require('../models/Cart');
const { protect } = require('../middleware/auth');
const { checkRole } = require('../middleware/role');

const router = express.Router();

const PAYMENT_METHODS = ['cod', 'online'];
const ORDER_STATUSES = ['pending', 'processing', 'shipped', 'delivered', 'cancelled'];
const FREE_SHIPPING_THRESHOLD = 5000;
const SHIPPING_FEE = 199;

const handleValidationErrors = (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        res.status(400).json({
            success: false,
            message: 'Validation failed',
            errors: errors.array()
        });
        return true;
    }
    return false;
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

const normalizePaymentMethod = (method) => {
    if (!method) return 'COD';
    const normalized = method.toString().toLowerCase();
    return normalized === 'online' ? 'Online' : 'COD';
};

const computeItemPrice = (gift, providedPrice) => {
    if (typeof providedPrice === 'number') {
        return providedPrice;
    }
    if (typeof gift.finalPrice === 'number') {
        return gift.finalPrice;
    }
    if (gift.discountType === 'flat') {
        return Math.max(0, gift.price - (gift.discount || 0));
    }
    return Math.max(0, gift.price - (gift.price * ((gift.discount || 0) / 100)));
};

const calculateOrderTotals = (items) => {
    const subtotal = items.reduce((total, item) => total + (item.price * item.quantity), 0);
    const isEligibleForFreeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;
    const shipping = subtotal === 0
        ? 0
        : isEligibleForFreeShipping
            ? 0
            : SHIPPING_FEE;
    const totalAmount = subtotal + shipping;

    return {
        subtotal,
        shipping,
        totalAmount,
        isEligibleForFreeShipping
    };
};

const mapShippingAddress = (addressPayload = {}) => {
    const {
        firstName,
        lastName,
        name,
        email,
        phone,
        address,
        addressLine1,
        addressLine2,
        city,
        state,
        pincode,
        country
    } = addressPayload;

    const fullName = name || [firstName, lastName].filter(Boolean).join(' ').trim() || '';

    return {
        name: fullName,
        email: email || addressPayload.email || '',
        phone: phone || addressPayload.phone || '',
        addressLine1: addressLine1 || address || '',
        addressLine2: addressLine2 || '',
        city: city || '',
        state: state || '',
        pincode: pincode || '',
        country: country || 'India'
    };
};

const formatGiftForOrder = (giftDoc) => {
    if (!giftDoc) return null;
    const plainGift = giftDoc.toObject ? giftDoc.toObject({ virtuals: true }) : giftDoc;
    const images = plainGift.images && plainGift.images.length
        ? plainGift.images
        : plainGift.heroImage
            ? [plainGift.heroImage]
            : [];

    const finalPrice = computeItemPrice(plainGift);

    return {
        _id: plainGift._id,
        giftId: plainGift._id,
        gemId: plainGift._id,
        name: plainGift.name,
        category: plainGift.category,
        headline: plainGift.headline,
        price: plainGift.price,
        discount: plainGift.discount || 0,
        discountType: plainGift.discountType || 'percentage',
        finalPrice,
        availability: plainGift.availability,
        stock: plainGift.stock,
        heroImage: plainGift.heroImage || images[0] || null,
        images,
        customizable: plainGift.customizable,
        recipient: plainGift.recipient,
        seller: plainGift.seller
    };
};

const formatOrderItem = (item) => {
    const giftDoc = item.gift || item.gem;
    const gift = formatGiftForOrder(giftDoc);
    const price = item.price;
    const quantity = item.quantity;

    return {
        giftId: gift ? gift._id : (item.gift || item.gem),
        gemId: gift ? gift._id : (item.gift || item.gem),
        quantity,
        price,
        lineTotal: price * quantity,
        gift
    };
};

const formatOrder = (orderDoc) => {
    const plainOrder = orderDoc.toObject ? orderDoc.toObject({ virtuals: true }) : orderDoc;
    const items = (plainOrder.items || []).map(formatOrderItem);
    const totals = calculateOrderTotals(items.map(item => ({
        price: item.price,
        quantity: item.quantity
    })));

    return {
        _id: plainOrder._id,
        orderId: plainOrder._id,
        orderNumber: plainOrder.orderNumber,
        status: plainOrder.status,
        paymentMethod: plainOrder.paymentMethod,
        totalAmount: plainOrder.totalPrice,
        totals: {
            subtotal: totals.subtotal,
            shipping: totals.shipping,
            total: plainOrder.totalPrice,
            freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
            isEligibleForFreeShipping: totals.isEligibleForFreeShipping
        },
        items,
        shippingAddress: plainOrder.shippingAddress,
        createdAt: plainOrder.createdAt,
        updatedAt: plainOrder.updatedAt,
        user: plainOrder.user
    };
};

router.post(
    '/',
    protect,
    checkRole('buyer'),
    [
        body('items')
            .isArray({ min: 1 })
            .withMessage('At least one item is required'),
        body('items.*.giftId')
            .optional()
            .isMongoId()
            .withMessage('giftId must be valid'),
        body('items.*.gemId')
            .optional()
            .isMongoId()
            .withMessage('gemId must be valid'),
        body('items.*.quantity')
            .isInt({ min: 1 })
            .withMessage('Quantity must be at least 1'),
        body('paymentMethod')
            .optional()
            .isIn(PAYMENT_METHODS)
            .withMessage('Payment method must be one of cod | online'),
        body('totalAmount')
            .optional()
            .isFloat({ min: 0 })
            .withMessage('Total amount must be positive'),
        body('shippingAddress').notEmpty().withMessage('Shipping address is required'),
        body('shippingAddress.phone').notEmpty().withMessage('Shipping phone is required')
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const {
                items: requestedItems,
                shippingAddress: shippingAddressPayload,
                paymentMethod,
                totalAmount,
                orderNotes
            } = req.body;

            const shippingAddress = mapShippingAddress(shippingAddressPayload);

            const orderItems = [];

            for (const item of requestedItems) {
                const giftId = item.giftId || item.gemId || item.gift || item.gem;
                if (!isValidObjectId(giftId)) {
                    return res.status(400).json({
                        success: false,
                        message: 'Invalid gift id in items'
                    });
                }

                const gift = await Gift.findById(giftId);
                if (!gift) {
                    return res.status(404).json({
                        success: false,
                        message: `Gift with id ${giftId} not found`
                    });
                }

                if (!gift.availability) {
                    return res.status(400).json({
                        success: false,
                        message: `${gift.name} is currently unavailable`
                    });
                }

                if (typeof gift.stock === 'number' && gift.stock >= 0 && item.quantity > gift.stock) {
                    return res.status(400).json({
                        success: false,
                        message: `Insufficient stock for ${gift.name}`
                    });
                }

                const price = computeItemPrice(gift, item.price);

                orderItems.push({
                    gift: gift._id,
                    gem: gift._id,
                    quantity: item.quantity,
                    price,
                    seller: gift.seller
                });
            }

            const totals = calculateOrderTotals(orderItems);
            if (typeof totalAmount === 'number' && Math.abs(totalAmount - totals.totalAmount) > 1) {
                return res.status(400).json({
                    success: false,
                    message: 'Total amount mismatch'
                });
            }

            const order = await Order.create({
                user: req.user._id,
                items: orderItems,
                shippingAddress,
                paymentMethod: normalizePaymentMethod(paymentMethod),
                paymentStatus: paymentMethod === 'online' ? 'pending' : 'pending',
                totalPrice: totals.totalAmount,
                notes: orderNotes
            });

            await order.populate([
                { path: 'items.gift', model: 'Gift' },
                { path: 'items.gem', model: 'Gift' }
            ]);

            await Cart.findOneAndUpdate(
                { user: req.user._id },
                { items: [] }
            );

            const formattedOrder = formatOrder(order);

            res.status(201).json({
                success: true,
                message: 'Order placed successfully',
                data: {
                    orderId: order._id,
                    orderNumber: order.orderNumber,
                    paymentMethod: formattedOrder.paymentMethod,
                    totalAmount: formattedOrder.totalAmount
                },
                order: formattedOrder
            });
        } catch (error) {
            console.error('Create order error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Server error during order creation'
            });
        }
    }
);

const buyerOrdersQueryValidators = [
    query('page').optional().toInt().isInt({ min: 1 }),
    query('limit').optional().toInt().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn(ORDER_STATUSES)
];

const fetchBuyerOrders = async (userId, filters = {}) => {
    const page = filters.page || 1;
    const limit = filters.limit || 10;
    const skip = (page - 1) * limit;

    const queryFilter = { user: userId };
    if (filters.status) {
        queryFilter.status = filters.status;
    }

    const [totalItems, orders] = await Promise.all([
        Order.countDocuments(queryFilter),
        Order.find(queryFilter)
            .populate('items.gift')
            .populate('items.gem')
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit)
    ]);

    const formattedOrders = orders.map(formatOrder);
    const totalPages = Math.max(1, Math.ceil(totalItems / limit) || 1);

    const pagination = {
        currentPage: page,
        totalPages,
        totalItems,
        itemsPerPage: limit,
        hasNext: page < totalPages,
        hasPrev: page > 1
    };

    return { orders: formattedOrders, pagination };
};

router.get('/', protect, checkRole('buyer'), buyerOrdersQueryValidators, async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    try {
        const { orders, pagination } = await fetchBuyerOrders(req.user._id, {
            page: req.query.page || 1,
            limit: req.query.limit || 10,
            status: req.query.status
        });

        res.json({
            success: true,
            data: {
                orders,
                pagination
            },
            orders,
            pagination
        });
    } catch (error) {
        console.error('Fetch buyer orders error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during orders retrieval'
        });
    }
});

router.get('/my-orders', protect, checkRole('buyer'), buyerOrdersQueryValidators, async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    try {
        const { orders, pagination } = await fetchBuyerOrders(req.user._id, {
            page: req.query.page || 1,
            limit: req.query.limit || 10,
            status: req.query.status
        });

        res.json({
            success: true,
            data: {
                orders,
                pagination
            },
            orders,
            pagination
        });
    } catch (error) {
        console.error('Fetch buyer orders error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during orders retrieval'
        });
    }
});

router.get('/seller/orders', protect, checkRole('seller'), buyerOrdersQueryValidators, async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    try {
        const page = req.query.page || 1;
        const limit = req.query.limit || 10;
        const skip = (page - 1) * limit;

        const filter = { 'items.seller': req.user._id };
        if (req.query.status) {
            filter.status = req.query.status;
        }

        const [totalItems, orders] = await Promise.all([
            Order.countDocuments(filter),
            Order.find(filter)
                .populate('items.gift')
                .populate('items.gem')
                .populate('user', 'name email phone')
                .sort({ createdAt: -1 })
                .skip(skip)
                .limit(limit)
        ]);

        const formattedOrders = orders.map(order => {
            const formatted = formatOrder(order);
            return {
                ...formatted,
                buyer: {
                    _id: order.user?._id,
                    name: order.user?.name,
                    email: order.user?.email,
                    phone: order.user?.phone || order.shippingAddress?.phone
                }
            };
        });

        const totalPages = Math.max(1, Math.ceil(totalItems / limit) || 1);

        res.json({
            success: true,
            data: {
                orders: formattedOrders,
                pagination: {
                    currentPage: page,
                    totalPages,
                    totalItems,
                    itemsPerPage: limit,
                    hasNext: page < totalPages,
                    hasPrev: page > 1
                }
            },
            orders: formattedOrders
        });
    } catch (error) {
        console.error('Fetch seller orders error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error during seller orders retrieval'
        });
    }
});

router.get(
    '/:id',
    protect,
    [
        param('id').isMongoId().withMessage('Order id must be valid')
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const order = await Order.findById(req.params.id)
                .populate('items.gift')
                .populate('items.gem')
                .populate('items.seller', 'name email phone')
                .populate('user', 'name email phone role');

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            const isBuyer = order.user?._id?.toString() === req.user._id.toString();
            const isSeller = order.items.some(item => item.seller?.toString() === req.user._id.toString());
            const isAdmin = req.user.role === 'admin';

            if (!isBuyer && !isSeller && !isAdmin) {
                return res.status(403).json({
                    success: false,
                    message: 'Not authorized to view this order'
                });
            }

            const formattedOrder = formatOrder(order);

            res.json({
                success: true,
                data: formattedOrder,
                order: formattedOrder
            });
        } catch (error) {
            console.error('Fetch order details error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error during order retrieval'
            });
        }
    }
);

router.put(
    '/:id/cancel',
    protect,
    checkRole('buyer'),
    [
        param('id').isMongoId().withMessage('Order id must be valid'),
        body('reason').optional().isString()
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const order = await Order.findById(req.params.id);

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            if (order.user.toString() !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'Not authorized to cancel this order'
                });
            }

            if (['shipped', 'delivered'].includes(order.status)) {
                return res.status(400).json({
                    success: false,
                    message: 'Cannot cancel order that has been shipped or delivered'
                });
            }

            if (order.status === 'cancelled') {
                return res.status(400).json({
                    success: false,
                    message: 'Order is already cancelled'
                });
            }

            await order.restoreStock();

            order.status = 'cancelled';
            order.cancelReason = req.body.reason || order.cancelReason;
            order.cancelledAt = new Date();
            await order.save({ validateBeforeSave: false });

            res.json({
                success: true,
                message: 'Order cancelled successfully'
            });
        } catch (error) {
            console.error('Cancel order error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error during order cancellation'
            });
        }
    }
);

router.put(
    '/:id/status',
    protect,
    checkRole('seller'),
    [
        param('id').isMongoId().withMessage('Order id must be valid'),
        body('status')
            .isIn(ORDER_STATUSES)
            .withMessage('Status must be pending | processing | shipped | delivered | cancelled'),
        body('trackingNumber').optional().isString(),
        body('courierName').optional().isString(),
        body('expectedDeliveryDate').optional().isISO8601()
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const order = await Order.findById(req.params.id);

            if (!order) {
                return res.status(404).json({
                    success: false,
                    message: 'Order not found'
                });
            }

            const hasSellerItem = order.items.some(item => item.seller?.toString() === req.user._id.toString());
            if (!hasSellerItem) {
                return res.status(403).json({
                    success: false,
                    message: 'Not authorized to update this order'
                });
            }

            order.status = req.body.status;
            order.trackingNumber = req.body.trackingNumber || order.trackingNumber;
            order.courierName = req.body.courierName || order.courierName;
            order.expectedDeliveryDate = req.body.expectedDeliveryDate || order.expectedDeliveryDate;
            await order.save();

            res.json({
                success: true,
                message: 'Order status updated successfully',
                order: {
                    orderId: order._id,
                    orderNumber: order.orderNumber,
                    status: order.status,
                    trackingNumber: order.trackingNumber,
                    courierName: order.courierName,
                    expectedDeliveryDate: order.expectedDeliveryDate
                }
            });
        } catch (error) {
            console.error('Update order status error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error during status update'
            });
        }
    }
);

module.exports = router;
