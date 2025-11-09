const express = require('express');
const { body, validationResult, query } = require('express-validator');
const mongoose = require('mongoose');
const Gift = require('../models/Gift');
const SellerProfile = require('../models/Seller');
const { protect } = require('../middleware/auth');
const { checkRole } = require('../middleware/role');

const router = express.Router();

const giftPayloadValidators = [
    body('name').trim().notEmpty().withMessage('Name is required'),
    body('description').trim().notEmpty().withMessage('Description is required'),
    body('price').isFloat({ min: 0 }).withMessage('Valid price is required'),
    body('discount').optional().isFloat({ min: 0 }).withMessage('Discount must be a positive number'),
    body('discountType').optional().isIn(['percentage', 'flat']).withMessage('Discount type must be percentage or flat'),
    body('stock').optional().isInt({ min: 0 }).withMessage('Stock must be zero or greater'),
    body('deliveryDays').optional().isInt({ min: 0 }).withMessage('Delivery days must be zero or greater'),
    body('customizable').optional().isBoolean(),
    body('availability').optional().isBoolean(),
    body('signatureTouches').optional().isArray().withMessage('Signature touches must be an array'),
    body('personalisation').optional().isArray().withMessage('Personalisation must be an array'),
    body('images').optional().isArray().withMessage('Images must be an array'),
    body('additionalImages').optional().isArray().withMessage('Additional images must be an array'),
    body('category').optional().isString(),
    body('headline').optional().isString(),
    body('leadTime').optional().isString(),
    body('priceRange').optional().isString(),
    body('sizeWeight').optional().isString(),
    body('sizeUnit').optional().isString(),
    body('recipient').optional().isString(),
    body('ageRange').optional().isString()
];

const listQueryValidators = [
    query('page').optional().toInt().isInt({ min: 1 }),
    query('limit').optional().toInt().isInt({ min: 1, max: 100 }),
    query('minPrice').optional().toFloat(),
    query('maxPrice').optional().toFloat(),
    query('customizable').optional().isBoolean().toBoolean(),
    query('availability').optional().isBoolean().toBoolean(),
    query('recipient').optional().isString(),
    query('category').optional().isString(),
    query('ageRange').optional().isString(),
    query('sort').optional().isIn(['newest', 'oldest', 'price-low', 'price-high', 'popular'])
];

const DEFAULT_PAGINATION_LIMIT = 12;

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

const toBoolean = (value) => {
    if (value === undefined) return undefined;
    if (typeof value === 'boolean') return value;
    return value === 'true' || value === '1';
};

const formatSellerProfile = (userDoc, sellerDoc) => {
    if (!userDoc && !sellerDoc) {
        return {
            _id: null,
            fullName: 'Unknown Seller',
            shopName: 'Gift Curator',
            isVerified: false,
            rating: 0
        };
    }

    if (sellerDoc) {
        return {
            _id: sellerDoc._id,
            fullName: sellerDoc.fullName,
            shopName: sellerDoc.shopName,
            rating: sellerDoc.rating || sellerDoc.stats?.averageRating || 0,
            isVerified: sellerDoc.isVerified ?? false
        };
    }

    return {
        _id: userDoc._id,
        fullName: userDoc.name || 'Gift Curator',
        shopName: 'Gift Curator',
        rating: 0,
        isVerified: false
    };
};

const formatGift = (giftDoc, sellerProfile) => {
    if (!giftDoc) return null;

    const plainGift = giftDoc.toObject ? giftDoc.toObject({ virtuals: true }) : giftDoc;
    const {
        _id,
        name,
        category,
        headline,
        description,
        signatureTouches = [],
        personalisation = [],
        leadTime,
        price,
        discount = 0,
        discountType = 'percentage',
        availability = true,
        stock = 0,
        sizeWeight,
        sizeUnit,
        priceRange,
        ageRange,
        recipient,
        customizable = false,
        images = [],
        heroImage,
        additionalImages = [],
        averageRating,
        totalReviews,
        deliveryDays,
        rating,
        reviews,
        hindiName,
        planet,
        planetHindi,
        color,
        benefits = [],
        suitableFor = [],
        whomToUse = [],
        certification,
        origin,
        views = 0,
        sales = 0,
        lowStockThreshold = 5,
        finalPrice
    } = plainGift;

    const galleryImages = images.length ? images : heroImage ? [heroImage] : [];
    const computedFinalPrice = typeof finalPrice === 'number'
        ? finalPrice
        : discountType === 'flat'
            ? Math.max(0, price - discount)
            : Math.max(0, price - (price * (discount / 100)));

    const sellerInfo = formatSellerProfile(plainGift.seller, sellerProfile);

    const base = {
        _id,
        name,
        category,
        headline,
        description,
        signatureTouches,
        personalisation,
        leadTime,
        price,
        discount,
        discountType,
        finalPrice: computedFinalPrice,
        availability,
        stock,
        sizeWeight,
        sizeUnit,
        priceRange,
        ageRange,
        recipient,
        customizable,
        images: galleryImages,
        heroImage: heroImage || galleryImages[0] || null,
        additionalImages,
        averageRating: (typeof averageRating === 'number' ? averageRating : rating) || 0,
        totalReviews: (typeof totalReviews === 'number' ? totalReviews : reviews) || 0,
        deliveryDays,
        seller: sellerInfo,
        views,
        sales,
        lowStockThreshold
    };

    return {
        ...base,
        giftId: _id,
        gift: base,
        // Legacy compatibility fields
        gemId: _id,
        gem: base,
        gemName: name,
        hindiName,
        planet,
        planetHindi,
        color,
        benefits,
        suitableFor,
        whomToUse,
        certification,
        origin
    };
};

const fetchSellerProfiles = async (gifts) => {
    const sellerIds = gifts
        .map(gift => {
            if (!gift.seller) return null;
            if (gift.seller._id) return gift.seller._id.toString();
            return gift.seller.toString();
        })
        .filter(Boolean);

    const uniqueSellerIds = [...new Set(sellerIds)];

    if (!uniqueSellerIds.length) {
        return new Map();
    }

    const sellers = await SellerProfile.find({ user: { $in: uniqueSellerIds } }).lean();
    const sellerMap = new Map();
    sellers.forEach(profile => {
        sellerMap.set(profile.user.toString(), profile);
    });

    return sellerMap;
};

const buildGiftFilter = (queryParams) => {
    const {
        search,
        category,
        recipient,
        ageRange,
        customizable,
        availability,
        minPrice,
        maxPrice,
        seller
    } = queryParams;

    const filter = {};

    if (search) {
        filter.$or = [
            { $text: { $search: search } },
            { name: { $regex: search, $options: 'i' } },
            { category: { $regex: search, $options: 'i' } },
            { headline: { $regex: search, $options: 'i' } },
            { description: { $regex: search, $options: 'i' } }
        ];
    }

    if (category) {
        const categories = category.split(',').map(cat => cat.trim()).filter(Boolean);
        if (categories.length) {
            filter.category = { $in: categories };
        }
    }

    if (recipient) {
        const audiences = recipient.split(',').map(value => value.trim()).filter(Boolean);
        if (audiences.length) {
            filter.recipient = { $in: audiences };
        }
    }

    if (ageRange) {
        filter.ageRange = { $regex: ageRange, $options: 'i' };
    }

    const customizableValue = toBoolean(customizable);
    if (typeof customizableValue === 'boolean') {
        filter.customizable = customizableValue;
    }

    const availabilityValue = toBoolean(availability);
    if (typeof availabilityValue === 'boolean') {
        filter.availability = availabilityValue;
    }

    if (minPrice !== undefined || maxPrice !== undefined) {
        filter.price = {};
        if (minPrice !== undefined) filter.price.$gte = Number(minPrice);
        if (maxPrice !== undefined) filter.price.$lte = Number(maxPrice);
    }

    if (seller) {
        filter.seller = seller;
    }

    return filter;
};

const buildSortOption = (sort) => {
    switch (sort) {
        case 'oldest':
            return { createdAt: 1 };
        case 'price-low':
            return { price: 1 };
        case 'price-high':
            return { price: -1 };
        case 'popular':
            return { sales: -1, views: -1 };
        case 'newest':
        default:
            return { createdAt: -1 };
    }
};

const isValidObjectId = (value) => mongoose.Types.ObjectId.isValid(value);

router.post(
    '/',
    protect,
    checkRole('seller'),
    giftPayloadValidators,
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const payload = {
                ...req.body,
                seller: req.user._id
            };

            // Normalize boolean fields that may arrive as strings
            if (payload.customizable !== undefined) {
                payload.customizable = toBoolean(payload.customizable);
            }

            if (payload.availability !== undefined) {
                payload.availability = toBoolean(payload.availability);
            }

            const gift = await Gift.create(payload);

            const sellerProfile = await SellerProfile.findOne({ user: req.user._id }).lean();
            const formattedGift = formatGift(gift, sellerProfile);

            res.status(201).json({
                success: true,
                message: 'Gift created successfully',
                data: formattedGift,
                gift: formattedGift,
                gem: formattedGift
            });
        } catch (error) {
            console.error('Create gift error:', error);
            res.status(500).json({
                success: false,
                message: 'Server error while creating gift',
                error: error.message
            });
        }
    }
);

router.get(
    '/',
    listQueryValidators,
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const {
                page = 1,
                limit = DEFAULT_PAGINATION_LIMIT,
                sort = 'newest'
            } = req.query;

            const filter = buildGiftFilter(req.query);
            const sortOption = buildSortOption(sort);

            const pageNumber = Number(page) || 1;
            const limitNumber = Number(limit) || DEFAULT_PAGINATION_LIMIT;
            const skip = (pageNumber - 1) * limitNumber;

            const [totalItems, gifts] = await Promise.all([
                Gift.countDocuments(filter),
                Gift.find(filter)
                    .populate('seller', 'name email phone')
                    .sort(sortOption)
                    .skip(skip)
                    .limit(limitNumber)
            ]);

            const sellerProfiles = await fetchSellerProfiles(gifts);
            const formattedGifts = gifts.map(gift => {
                const sellerId = gift.seller?._id
                    ? gift.seller._id.toString()
                    : gift.seller?.toString();
                const sellerProfile = sellerId ? sellerProfiles.get(sellerId) : null;
                return formatGift(gift, sellerProfile);
            });

            const totalPages = Math.max(1, Math.ceil(totalItems / limitNumber) || 1);

            const pagination = {
                currentPage: pageNumber,
                totalPages,
                totalItems,
                totalGifts: totalItems,
                itemsPerPage: limitNumber,
                hasNext: pageNumber < totalPages,
                hasPrev: pageNumber > 1
            };

            res.json({
                success: true,
                data: {
                    gifts: formattedGifts,
                    pagination
                },
                gifts: formattedGifts,
                gems: formattedGifts,
                pagination
            });
        } catch (error) {
            console.error('List gifts error:', error);
            res.status(500).json({
                success: false,
                message: 'Error fetching gifts',
                error: error.message
            });
        }
    }
);

router.get('/categories', async (_req, res) => {
    try {
        const categories = await Gift.distinct('category', {
            category: { $nin: [null, '', undefined] }
        });

        res.json({
            success: true,
            data: categories.sort(),
            categories: categories.sort()
        });
    } catch (error) {
        console.error('Get gift categories error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching gift categories',
            error: error.message
        });
    }
});

router.get(['/suggestions', '/search-suggestions'], async (req, res) => {
    try {
        const searchTerm = req.query.search || req.query.q || '';
        if (!searchTerm || searchTerm.trim().length < 2) {
            return res.json({
                success: true,
                data: { gifts: [] },
                suggestions: []
            });
        }

        const regex = new RegExp(searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');

        const gifts = await Gift.find({
            availability: true,
            $or: [
                { name: { $regex: regex } },
                { category: { $regex: regex } },
                { headline: { $regex: regex } }
            ]
        })
            .select('name')
            .limit(10)
            .lean();

        const suggestions = Array.from(new Set(gifts.map(item => item.name))).slice(0, 8);

        res.json({
            success: true,
            data: { gifts: suggestions },
            suggestions
        });
    } catch (error) {
        console.error('Gift suggestions error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching suggestions',
            error: error.message
        });
    }
});

router.get('/category/:category', async (req, res) => {
    try {
        const { category } = req.params;

        const gifts = await Gift.find({
            category: { $regex: `^${category}$`, $options: 'i' },
            availability: true
        })
            .populate('seller', 'name email phone')
            .sort({ createdAt: -1 });

        const sellerProfiles = await fetchSellerProfiles(gifts);
        const formatted = gifts.map(gift => {
            const sellerId = gift.seller?._id
                ? gift.seller._id.toString()
                : gift.seller?.toString();
            const sellerProfile = sellerId ? sellerProfiles.get(sellerId) : null;
            return formatGift(gift, sellerProfile);
        });

        res.json({
            success: true,
            category,
            count: formatted.length,
            data: formatted,
            gifts: formatted,
            gems: formatted
        });
    } catch (error) {
        console.error('Get gifts by category error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching gifts by category',
            error: error.message
        });
    }
});

router.get('/audience/:audience', async (req, res) => {
    try {
        const { audience } = req.params;

        const normalizedAudience = audience.toLowerCase();
        const audienceMapping = {
            kids: ['boy', 'girl', 'kids'],
            adults: ['men', 'women', 'adult', 'adults'],
            men: ['men', 'adult'],
            women: ['women', 'adult'],
            boys: ['boy', 'kids'],
            girls: ['girl', 'kids']
        };

        const recipients = audienceMapping[normalizedAudience] || [normalizedAudience];

        const gifts = await Gift.find({
            recipient: { $in: recipients },
            availability: true
        })
            .populate('seller', 'name email phone')
            .sort({ createdAt: -1 });

        const sellerProfiles = await fetchSellerProfiles(gifts);
        const formatted = gifts.map(gift => {
            const sellerId = gift.seller?._id
                ? gift.seller._id.toString()
                : gift.seller?.toString();
            const sellerProfile = sellerId ? sellerProfiles.get(sellerId) : null;
            return formatGift(gift, sellerProfile);
        });

        res.json({
            success: true,
            audience,
            count: formatted.length,
            data: formatted,
            gifts: formatted,
            gems: formatted
        });
    } catch (error) {
        console.error('Get gifts by audience error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching gifts by audience',
            error: error.message
        });
    }
});

router.get('/my-gifts', protect, checkRole('seller'), async (req, res) => {
    try {
        const gifts = await Gift.find({ seller: req.user._id })
            .populate('seller', 'name email phone')
            .sort({ createdAt: -1 });

        const sellerProfile = await SellerProfile.findOne({ user: req.user._id }).lean();
        const formatted = gifts.map(gift => formatGift(gift, sellerProfile));

        res.json({
            success: true,
            count: formatted.length,
            data: formatted,
            gifts: formatted,
            gems: formatted
        });
    } catch (error) {
        console.error('Get seller gifts error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching seller gifts',
            error: error.message
        });
    }
});

router.get('/:id', async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gift id'
            });
        }

        const gift = await Gift.findById(id)
            .populate('seller', 'name email phone');

        if (!gift) {
            return res.status(404).json({
                success: false,
                message: 'Gift not found'
            });
        }

        const sellerProfile = await SellerProfile.findOne({ user: gift.seller?._id || gift.seller }).lean();
        const formattedGift = formatGift(gift, sellerProfile);

        const relatedFilter = {
            _id: { $ne: gift._id },
            availability: true,
            $or: [
                { category: gift.category },
                { recipient: gift.recipient },
                { price: { $gte: gift.price * 0.7, $lte: gift.price * 1.3 } }
            ]
        };

        const relatedGifts = await Gift.find(relatedFilter)
            .populate('seller', 'name email phone')
            .sort({ createdAt: -1 })
            .limit(8);

        const relatedSellerProfiles = await fetchSellerProfiles(relatedGifts);
        const formattedRelated = relatedGifts.map(relatedGift => {
            const sellerId = relatedGift.seller?._id
                ? relatedGift.seller._id.toString()
                : relatedGift.seller?.toString();
            const profile = sellerId ? relatedSellerProfiles.get(sellerId) : null;
            return formatGift(relatedGift, profile);
        });

        res.json({
            success: true,
            data: formattedGift,
            gift: formattedGift,
            gem: formattedGift,
            relatedProducts: formattedRelated,
            relatedGifts: formattedRelated,
            relatedGems: formattedRelated
        });
    } catch (error) {
        console.error('Get gift detail error:', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching gift details',
            error: error.message
        });
    }
});

router.put('/:id', protect, checkRole('seller'), giftPayloadValidators, async (req, res) => {
    if (handleValidationErrors(req, res)) return;

    try {
        const { id } = req.params;

        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gift id'
            });
        }

        const existingGift = await Gift.findById(id);
        if (!existingGift) {
            return res.status(404).json({
                success: false,
                message: 'Gift not found'
            });
        }

        if (existingGift.seller.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to update this gift'
            });
        }

        const payload = { ...req.body };
        if (payload.customizable !== undefined) {
            payload.customizable = toBoolean(payload.customizable);
        }
        if (payload.availability !== undefined) {
            payload.availability = toBoolean(payload.availability);
        }

        Object.assign(existingGift, payload);
        await existingGift.save();

        const sellerProfile = await SellerProfile.findOne({ user: req.user._id }).lean();
        const formattedGift = formatGift(existingGift, sellerProfile);

        res.json({
            success: true,
            message: 'Gift updated successfully',
            data: formattedGift,
            gift: formattedGift,
            gem: formattedGift
        });
    } catch (error) {
        console.error('Update gift error:', error);
        res.status(500).json({
            success: false,
            message: 'Error updating gift',
            error: error.message
        });
    }
});

router.delete('/:id', protect, checkRole('seller'), async (req, res) => {
    try {
        const { id } = req.params;

        if (!isValidObjectId(id)) {
            return res.status(400).json({
                success: false,
                message: 'Invalid gift id'
            });
        }

        const gift = await Gift.findById(id);
        if (!gift) {
            return res.status(404).json({
                success: false,
                message: 'Gift not found'
            });
        }

        if (gift.seller.toString() !== req.user._id.toString()) {
            return res.status(403).json({
                success: false,
                message: 'Not authorized to delete this gift'
            });
        }

        await gift.deleteOne();

        res.json({
            success: true,
            message: 'Gift deleted successfully'
        });
    } catch (error) {
        console.error('Delete gift error:', error);
        res.status(500).json({
            success: false,
            message: 'Error deleting gift',
            error: error.message
        });
    }
});

module.exports = router;
