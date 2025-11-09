const mongoose = require('mongoose');

const reviewSchema = new mongoose.Schema({
    giftId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gift',
        required: [true, 'Gift ID is required'],
        index: true
    },
    gemId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gift'
    },
    userId: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'User ID is required'],
        index: true
    },
    rating: {
        type: Number,
        required: [true, 'Rating is required'],
        min: [1, 'Rating must be at least 1'],
        max: [5, 'Rating cannot exceed 5']
    },
    comment: {
        type: String,
        trim: true,
        maxlength: [1000, 'Comment cannot exceed 1000 characters']
    }
}, {
    timestamps: true
});

reviewSchema.pre('validate', function (next) {
    if (this.giftId && !this.gemId) {
        this.gemId = this.giftId;
    }
    if (this.gemId && !this.giftId) {
        this.giftId = this.gemId;
    }
    next();
});

// Prevent duplicate reviews - one user can only review a gift once
reviewSchema.index({ giftId: 1, userId: 1 }, { unique: true });

module.exports = mongoose.model('Review', reviewSchema);
