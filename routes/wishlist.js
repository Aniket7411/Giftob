const express = require('express');
const { body, validationResult, param } = require('express-validator');
const mongoose = require('mongoose');
const { protect } = require('../middleware/auth');
const Wishlist = require('../models/Wishlist');
const Gift = require('../models/Gift');

const router = express.Router();

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

const formatGiftForWishlist = (giftDoc) => {
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

const formatWishlistItem = (item) => {
    const giftDoc = item.gift || item.gem;
    const gift = formatGiftForWishlist(giftDoc);
    const giftId = gift ? gift._id : (item.gift || item.gem);

    return {
        _id: item._id,
        giftId,
        gemId: giftId,
        addedAt: item.addedAt,
        gift
    };
};

const loadWishlist = async (userId, { createIfMissing = false } = {}) => {
    let wishlist = await Wishlist.findOne({ user: userId })
        .populate({ path: 'items.gift', model: 'Gift' })
        .populate({ path: 'items.gem', model: 'Gift' });

    if (!wishlist && createIfMissing) {
        wishlist = await Wishlist.create({ user: userId, items: [] });
    }

    return wishlist;
};

router.post(
    '/add',
    protect,
    [
        body('giftId')
            .optional()
            .isMongoId()
            .withMessage('giftId must be a valid id'),
        body('gemId')
            .optional()
            .isMongoId()
            .withMessage('gemId must be a valid id'),
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

            const gift = await Gift.findById(giftId);
            if (!gift) {
                return res.status(404).json({
                    success: false,
                    message: 'Gift not found'
                });
            }

            const wishlist = await loadWishlist(req.user._id, { createIfMissing: true });

            const alreadyExists = wishlist.items.some(item => {
                const id = (item.gift || item.gem || '').toString();
                return id === giftId;
            });

            if (alreadyExists) {
                return res.status(400).json({
                    success: false,
                    message: 'Gift already in wishlist'
                });
            }

            wishlist.items.push({
                gift: gift._id,
                gem: gift._id
            });

            await wishlist.save();
            await wishlist.populate([
                { path: 'items.gift', model: 'Gift' },
                { path: 'items.gem', model: 'Gift' }
            ]);

            const formattedItems = wishlist.items.map(formatWishlistItem);

            res.json({
                success: true,
                message: 'Gift added to wishlist',
                items: formattedItems,
                totalItems: formattedItems.length
            });
        } catch (error) {
            console.error('Wishlist add error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error while adding to wishlist',
                error: error.message
            });
        }
    }
);

router.get('/', protect, async (req, res) => {
    try {
        const wishlist = await loadWishlist(req.user._id);

        if (!wishlist || wishlist.items.length === 0) {
            return res.json({
                success: true,
                items: [],
                totalItems: 0
            });
        }

        const formattedItems = wishlist.items
            .filter(item => !!(item.gift || item.gem))
            .map(formatWishlistItem);

        res.json({
            success: true,
            items: formattedItems,
            totalItems: formattedItems.length
        });
    } catch (error) {
        console.error('Wishlist fetch error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching wishlist',
            error: error.message
        });
    }
});

router.delete(
    '/remove/:giftId',
    protect,
    [
        param('giftId').isMongoId().withMessage('giftId must be a valid id')
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const { giftId } = req.params;
            const wishlist = await loadWishlist(req.user._id);

            if (!wishlist) {
                return res.status(404).json({
                    success: false,
                    message: 'Wishlist not found'
                });
            }

            const initialLength = wishlist.items.length;
            wishlist.items = wishlist.items.filter(item => {
                const id = (item.gift || item.gem || '').toString();
                return id !== giftId;
            });

            if (wishlist.items.length === initialLength) {
                return res.status(404).json({
                    success: false,
                    message: 'Gift not found in wishlist'
                });
            }

            await wishlist.save();
            await wishlist.populate([
                { path: 'items.gift', model: 'Gift' },
                { path: 'items.gem', model: 'Gift' }
            ]);

            const formattedItems = wishlist.items.map(formatWishlistItem);

            res.json({
                success: true,
                message: 'Gift removed from wishlist',
                items: formattedItems,
                totalItems: formattedItems.length
            });
        } catch (error) {
            console.error('Wishlist remove error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error while removing gift',
                error: error.message
            });
        }
    }
);

router.get(
    '/check/:giftId',
    protect,
    [
        param('giftId').isMongoId().withMessage('giftId must be a valid id')
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const { giftId } = req.params;
            const wishlist = await loadWishlist(req.user._id);

            if (!wishlist) {
                return res.json({
                    success: true,
                    isInWishlist: false
                });
            }

            const isInWishlist = wishlist.items.some(item => {
                const id = (item.gift || item.gem || '').toString();
                return id === giftId;
            });

            res.json({
                success: true,
                isInWishlist,
                giftId,
                gemId: giftId
            });
        } catch (error) {
            console.error('Wishlist check error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error while checking wishlist',
                error: error.message
            });
        }
    }
);

router.delete('/clear', protect, async (req, res) => {
    try {
        const wishlist = await loadWishlist(req.user._id);

        if (!wishlist) {
            return res.status(404).json({
                success: false,
                message: 'Wishlist not found'
            });
        }

        wishlist.items = [];
        await wishlist.save();

        res.json({
            success: true,
            message: 'Wishlist cleared',
            items: [],
            totalItems: 0
        });
    } catch (error) {
        console.error('Wishlist clear error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while clearing wishlist',
            error: error.message
        });
    }
});

router.get('/count', protect, async (req, res) => {
    try {
        const wishlist = await loadWishlist(req.user._id);
        const count = wishlist ? wishlist.items.length : 0;

        res.json({
            success: true,
            count
        });
    } catch (error) {
        console.error('Wishlist count error:', error);
        res.status(500).json({
            success: false,
            message: 'Server error while fetching wishlist count',
            error: error.message
        });
    }
});

module.exports = router;
