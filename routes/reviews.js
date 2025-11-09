const express = require('express');
const mongoose = require('mongoose');
const { body, validationResult, param, query } = require('express-validator');
const Review = require('../models/Review');
const Gift = require('../models/Gift');
const { protect } = require('../middleware/auth');

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

const formatReview = (reviewDoc) => {
    const plainReview = reviewDoc.toObject ? reviewDoc.toObject() : reviewDoc;
    const giftDoc = plainReview.giftId || plainReview.gemId;

    return {
        _id: plainReview._id,
        giftId: plainReview.giftId?._id || plainReview.giftId || plainReview.gemId,
        gemId: plainReview.gemId?._id || plainReview.gemId || plainReview.giftId,
        rating: plainReview.rating,
        comment: plainReview.comment,
        user: plainReview.userId ? {
            _id: plainReview.userId._id,
            name: plainReview.userId.name,
            email: plainReview.userId.email
        } : undefined,
        gift: giftDoc && giftDoc._id ? {
            _id: giftDoc._id,
            name: giftDoc.name,
            heroImage: giftDoc.heroImage,
            price: giftDoc.price,
            finalPrice: giftDoc.finalPrice
        } : undefined,
        createdAt: plainReview.createdAt,
        updatedAt: plainReview.updatedAt
    };
};

router.post(
    '/:giftId',
    protect,
    [
        param('giftId').isMongoId().withMessage('Gift id must be valid'),
        body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
        body('comment').optional().trim().isLength({ max: 1000 }).withMessage('Comment cannot exceed 1000 characters')
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const giftId = req.params.giftId;
            const { rating, comment } = req.body;

            const gift = await Gift.findById(giftId);
            if (!gift) {
                return res.status(404).json({
                    success: false,
                    message: 'Gift not found'
                });
            }

            const existingReview = await Review.findOne({ giftId, userId: req.user._id });
            if (existingReview) {
                return res.status(400).json({
                    success: false,
                    message: 'You have already reviewed this gift'
                });
            }

            const review = await Review.create({
                giftId,
                gemId: giftId,
                userId: req.user._id,
                rating,
                comment: comment || ''
            });

            await review.populate([
                { path: 'userId', select: 'name email' },
                { path: 'giftId', model: 'Gift' }
            ]);

            const formattedReview = formatReview(review);

            res.status(201).json({
                success: true,
                message: 'Review submitted successfully',
                review: formattedReview
            });
        } catch (error) {
            console.error('Submit review error:', error);
            if (error.code === 11000) {
                return res.status(400).json({
                    success: false,
                    message: 'You have already reviewed this gift'
                });
            }
            res.status(500).json({
                success: false,
                message: error.message || 'Server error during review submission'
            });
        }
    }
);

router.get(
    '/gift/:giftId',
    [
        param('giftId').isMongoId().withMessage('Gift id must be valid'),
        query('page').optional().toInt().isInt({ min: 1 }),
        query('limit').optional().toInt().isInt({ min: 1, max: 100 }),
        query('sort').optional().isIn(['newest', 'oldest', 'rating'])
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const { giftId } = req.params;
            const page = req.query.page || 1;
            const limit = req.query.limit || 10;
            const sort = req.query.sort || 'newest';

            if (!isValidObjectId(giftId)) {
                return res.status(400).json({
                    success: false,
                    message: 'Invalid gift id'
                });
            }

            const gift = await Gift.findById(giftId);
            if (!gift) {
                return res.status(404).json({
                    success: false,
                    message: 'Gift not found'
                });
            }

            const sortOption = (() => {
                switch (sort) {
                    case 'rating':
                        return { rating: -1, createdAt: -1 };
                    case 'oldest':
                        return { createdAt: 1 };
                    case 'newest':
                    default:
                        return { createdAt: -1 };
                }
            })();

            const skip = (page - 1) * limit;

            const [totalReviews, reviews, ratingStats] = await Promise.all([
                Review.countDocuments({ giftId }),
                Review.find({ giftId })
                    .populate({ path: 'userId', select: 'name email' })
                    .sort(sortOption)
                    .skip(skip)
                    .limit(limit),
                Review.aggregate([
                    { $match: { giftId: new mongoose.Types.ObjectId(giftId) } },
                    {
                        $group: {
                            _id: '$giftId',
                            averageRating: { $avg: '$rating' },
                            totalRatings: { $sum: 1 }
                        }
                    }
                ])
            ]);

            const averageRating = ratingStats.length ? ratingStats[0].averageRating : 0;
            const formattedReviews = reviews.map(formatReview);
            const totalPages = Math.max(1, Math.ceil(totalReviews / limit) || 1);

            res.json({
                success: true,
                data: {
                    reviews: formattedReviews,
                    averageRating: Math.round(averageRating * 10) / 10,
                    totalReviews,
                    pagination: {
                        currentPage: page,
                        totalPages,
                        totalItems: totalReviews,
                        itemsPerPage: limit,
                        hasNext: page < totalPages,
                        hasPrev: page > 1
                    }
                }
            });
        } catch (error) {
            console.error('Fetch gift reviews error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Server error during reviews retrieval'
            });
        }
    }
);

router.get('/user', protect, async (req, res) => {
    try {
        const reviews = await Review.find({ userId: req.user._id })
            .populate({ path: 'giftId', select: 'name heroImage price finalPrice' })
            .sort({ createdAt: -1 });

        const formattedReviews = reviews.map(formatReview);

        res.json({
            success: true,
            reviews: formattedReviews
        });
    } catch (error) {
        console.error('Fetch user reviews error:', error);
        res.status(500).json({
            success: false,
            message: error.message || 'Server error during reviews retrieval'
        });
    }
});

router.put(
    '/:reviewId',
    protect,
    [
        param('reviewId').isMongoId().withMessage('Review id must be valid'),
        body('rating').optional().isInt({ min: 1, max: 5 }).withMessage('Rating must be between 1 and 5'),
        body('comment').optional().trim().isLength({ max: 1000 }).withMessage('Comment cannot exceed 1000 characters')
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const { reviewId } = req.params;
            const { rating, comment } = req.body;

            const review = await Review.findById(reviewId);
            if (!review) {
                return res.status(404).json({
                    success: false,
                    message: 'Review not found'
                });
            }

            if (review.userId.toString() !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not authorized to update this review'
                });
            }

            if (rating !== undefined) review.rating = rating;
            if (comment !== undefined) review.comment = comment;

            await review.save();
            await review.populate([
                { path: 'userId', select: 'name email' },
                { path: 'giftId', select: 'name heroImage price finalPrice' }
            ]);

            res.json({
                success: true,
                message: 'Review updated successfully',
                review: formatReview(review)
            });
        } catch (error) {
            console.error('Update review error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Server error during review update'
            });
        }
    }
);

router.delete(
    '/:reviewId',
    protect,
    [
        param('reviewId').isMongoId().withMessage('Review id must be valid')
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const { reviewId } = req.params;

            const review = await Review.findById(reviewId);
            if (!review) {
                return res.status(404).json({
                    success: false,
                    message: 'Review not found'
                });
            }

            if (review.userId.toString() !== req.user._id.toString()) {
                return res.status(403).json({
                    success: false,
                    message: 'You are not authorized to delete this review'
                });
            }

            await review.deleteOne();

            res.json({
                success: true,
                message: 'Review deleted successfully'
            });
        } catch (error) {
            console.error('Delete review error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Server error during review deletion'
            });
        }
    }
);

router.get(
    '/check/:giftId',
    protect,
    [
        param('giftId').isMongoId().withMessage('Gift id must be valid')
    ],
    async (req, res) => {
        if (handleValidationErrors(req, res)) return;

        try {
            const { giftId } = req.params;

            const review = await Review.findOne({
                giftId,
                userId: req.user._id
            });

            res.json({
                success: true,
                hasReviewed: !!review,
                review: review ? formatReview(review) : null
            });
        } catch (error) {
            console.error('Check review error:', error);
            res.status(500).json({
                success: false,
                message: error.message || 'Server error during review check'
            });
        }
    }
);

module.exports = router;
