const express = require('express');
const { body, validationResult } = require('express-validator');
const mongoose = require('mongoose');
const Cart = require('../models/Cart');
const Gift = require('../models/Gift');
const { protect } = require('../middleware/auth');
const { checkRole } = require('../middleware/role');

const router = express.Router();

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

const formatGiftForCart = (giftDoc) => {
    if (!giftDoc) return null;
    const plainGift = giftDoc.toObject ? giftDoc.toObject({ virtuals: true }) : giftDoc;
    const images = plainGift.images && plainGift.images.length
        ? plainGift.images
        : plainGift.heroImage
            ? [plainGift.heroImage]
            : [];

    const finalPrice = typeof plainGift.finalPrice === 'number'
        ? plainGift.finalPrice
        : plainGift.discountType === 'flat'
            ? Math.max(0, plainGift.price - (plainGift.discount || 0))
            : Math.max(0, plainGift.price - (plainGift.price * ((plainGift.discount || 0) / 100)));

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
        recipient: plainGift.recipient
    };
};

const computeCartSummary = (items) => {
    const subtotal = items.reduce((total, item) => total + (item.lineTotal || 0), 0);
    const itemCount = items.reduce((total, item) => total + item.quantity, 0);
    const isEligibleForFreeShipping = subtotal >= FREE_SHIPPING_THRESHOLD;
    const shipping = subtotal === 0
        ? 0
        : isEligibleForFreeShipping
            ? 0
            : SHIPPING_FEE;
    const total = subtotal + shipping;

    return {
        subtotal,
        shipping,
        total,
        freeShippingThreshold: FREE_SHIPPING_THRESHOLD,
        isEligibleForFreeShipping,
        itemCount
    };
};

const formatCartResponse = (cart) => {
    if (!cart) {
        return {
            items: [],
            summary: computeCartSummary([])
        };
    }

    const items = cart.items.map(item => {
        const giftDoc = item.gift || item.gem;
        const formattedGift = formatGiftForCart(giftDoc);
        const giftId = formattedGift ? formattedGift._id : (item.gift || item.gem);

        return {
            _id: item._id,
            giftId,
            gemId: giftId,
            quantity: item.quantity,
            price: item.price,
            lineTotal: item.price * item.quantity,
            gift: formattedGift
        };
    });

    const summary = computeCartSummary(items);

    return {
        items,
        summary
    };
};

const getOrCreateCart = async (userId, { createIfMissing = false } = {}) => {
    let cart = await Cart.findOne({ user: userId })
        .populate({
            path: 'items.gift',
            model: 'Gift'
        })
        .populate({
            path: 'items.gem',
            model: 'Gift'
        });

    if (!cart && createIfMissing) {
        cart = await Cart.create({ user: userId, items: [] });
        await cart.populate({
            path: 'items.gift',
            model: 'Gift'
        });
    }

    return cart;
};

const findGiftOrFail = async (giftId) => {
    if (!giftId || !isValidObjectId(giftId)) {
        return null;
    }
    const gift = await Gift.findById(giftId);
    return gift;
};

router.post(
    '/add',
    protect,
    checkRole('buyer'),
    [
        body('giftId')
            .optional()
            .isMongoId()
            .withMessage('giftId must be a valid id'),
        body('gemId')
            .optional()
            .isMongoId()
            .withMessage('gemId must be a valid id'),
        body('quantity')
            .isInt({ min: 1 })
            .withMessage('Quantity must be at least 1'),
        body().custom(value => {
            if (!value.giftId && !value.gemId) {
                throw new Error('giftId is required');
            }
            return true;
        })
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const giftId = req.body.giftId || req.body.gemId;
            const quantityToAdd = Number(req.body.quantity);

            const gift = await findGiftOrFail(giftId);
            if (!gift) {
                return res.status(404).json({
                    success: false,
                    message: 'Gift not found'
                });
            }

            if (!gift.availability) {
                return res.status(400).json({
                    success: false,
                    message: 'Gift is currently unavailable'
                });
            }

            const cart = await getOrCreateCart(req.user._id, { createIfMissing: true });

            const existingItem = cart.items.find(item => {
                const id = (item.gift || item.gem || '').toString();
                return id === giftId;
            });

            const newQuantity = existingItem
                ? existingItem.quantity + quantityToAdd
                : quantityToAdd;

            if (typeof gift.stock === 'number' && gift.stock >= 0 && newQuantity > gift.stock) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient stock for the requested quantity'
                });
            }

            if (existingItem) {
                existingItem.quantity = newQuantity;
                existingItem.price = gift.finalPrice || gift.price;
            } else {
                cart.items.push({
                    gift: gift._id,
                    gem: gift._id,
                    quantity: quantityToAdd,
                    price: gift.finalPrice || gift.price
                });
            }

            await cart.save();
            await cart.populate([
                { path: 'items.gift', model: 'Gift' },
                { path: 'items.gem', model: 'Gift' }
            ]);

            const payload = formatCartResponse(cart);

            res.json({
                success: true,
                message: 'Gift added to cart',
                ...payload
            });
        } catch (error) {
            console.error('Add to cart error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error during cart update',
                error: error.message
            });
        }
    }
);

router.get('/', protect, checkRole('buyer'), async (req, res) => {
    try {
        const cart = await getOrCreateCart(req.user._id);

        if (!cart || cart.items.length === 0) {
            const emptyPayload = formatCartResponse(null);
            return res.json({
                success: true,
                items: emptyPayload.items,
                summary: emptyPayload.summary
            });
        }

        const payload = formatCartResponse(cart);

        res.json({
            success: true,
            items: payload.items,
            summary: payload.summary
        });
    } catch (error) {
        console.error('Get cart error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching cart',
            error: error.message
        });
    }
});

router.put(
    '/update/:giftId',
    protect,
    checkRole('buyer'),
    [
        body('quantity')
            .isInt({ min: 1 })
            .withMessage('Quantity must be at least 1')
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const { giftId } = req.params;
            const quantity = Number(req.body.quantity);

            if (!isValidObjectId(giftId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid gift id'
                });
            }

            const cart = await getOrCreateCart(req.user._id);
            if (!cart) {
                return res.status(404).json({
                    success: false,
                    message: 'Cart not found'
                });
            }

            const cartItem = cart.items.find(item => {
                const id = (item.gift || item.gem || '').toString();
                return id === giftId;
            });

            if (!cartItem) {
                return res.status(404).json({
                    success: false,
                    message: 'Item not found in cart'
                });
            }

            const gift = await findGiftOrFail(giftId);
            if (!gift) {
                return res.status(404).json({
                    success: false,
                    message: 'Gift not found'
                });
            }

            if (!gift.availability) {
                return res.status(400).json({
                    success: false,
                    message: 'Gift is currently unavailable'
                });
            }

            if (typeof gift.stock === 'number' && gift.stock >= 0 && quantity > gift.stock) {
                return res.status(400).json({
                    success: false,
                    message: 'Insufficient stock for the requested quantity'
                });
            }

            cartItem.quantity = quantity;
            cartItem.price = gift.finalPrice || gift.price;

            await cart.save();
            await cart.populate([
                { path: 'items.gift', model: 'Gift' },
                { path: 'items.gem', model: 'Gift' }
            ]);

            const payload = formatCartResponse(cart);

            res.json({
                success: true,
                message: 'Cart updated successfully',
                ...payload
            });
        } catch (error) {
            console.error('Update cart error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error while updating cart',
                error: error.message
            });
        }
    }
);

router.delete('/remove/:giftId', protect, checkRole('buyer'), async (req, res) => {
    try {
        const { giftId } = req.params;

        if (!isValidObjectId(giftId)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gift id'
            });
        }

        const cart = await getOrCreateCart(req.user._id);
        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        const initialLength = cart.items.length;
        cart.items = cart.items.filter(item => {
            const id = (item.gift || item.gem || '').toString();
            return id !== giftId;
        });

        if (cart.items.length === initialLength) {
            return res.status(404).json({
                success: false,
                message: 'Item not found in cart'
            });
        }

        await cart.save();
        await cart.populate([
            { path: 'items.gift', model: 'Gift' },
            { path: 'items.gem', model: 'Gift' }
        ]);

        const payload = formatCartResponse(cart);

        res.json({
            success: true,
            message: 'Item removed from cart',
            ...payload
        });
    } catch (error) {
        console.error('Remove cart item error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while removing cart item',
            error: error.message
        });
    }
});

router.delete('/clear', protect, checkRole('buyer'), async (req, res) => {
    try {
        const cart = await getOrCreateCart(req.user._id);

        if (!cart) {
            return res.status(404).json({
                success: false,
                message: 'Cart not found'
            });
        }

        cart.items = [];
        await cart.save();

        const payload = formatCartResponse(cart);

        res.json({
            success: true,
            message: 'Cart cleared successfully',
            ...payload
        });
    } catch (error) {
        console.error('Clear cart error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while clearing cart',
            error: error.message
        });
    }
});

module.exports = router;
