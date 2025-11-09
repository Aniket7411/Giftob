const mongoose = require('mongoose');

const wishlistItemSchema = new mongoose.Schema({
    gift: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gift',
        required: true
    },
    gem: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gift'
    },
    addedAt: {
        type: Date,
        default: Date.now
    }
});

wishlistItemSchema.pre('save', function (next) {
    if (this.gift && !this.gem) {
        this.gem = this.gift;
    }
    if (this.gem && !this.gift) {
        this.gift = this.gem;
    }
    next();
});

wishlistItemSchema.virtual('giftId').get(function () {
    return this.gift || this.gem;
});

const wishlistSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true  // Each user has only one wishlist
    },
    items: [wishlistItemSchema]
}, {
    timestamps: true
});

// Indexes for faster queries
wishlistSchema.index({ user: 1 });
wishlistSchema.index({ 'items.gem': 1 });
wishlistSchema.index({ 'items.gift': 1 });

module.exports = mongoose.model('Wishlist', wishlistSchema);
