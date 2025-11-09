const mongoose = require('mongoose');

const cartItemSchema = new mongoose.Schema({
    gift: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gift',
        required: true
    },
    gem: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'Gift'
    },
    quantity: {
        type: Number,
        required: true,
        min: [1, 'Quantity must be at least 1'],
        default: 1
    },
    price: {
        type: Number,
        required: true,
        min: [0, 'Price cannot be negative']
    },
    addedAt: {
        type: Date,
        default: Date.now
    }
});

cartItemSchema.pre('save', function (next) {
    if (this.gift && !this.gem) {
        this.gem = this.gift;
    }
    if (this.gem && !this.gift) {
        this.gift = this.gem;
    }
    next();
});

cartItemSchema.virtual('giftId').get(function () {
    return this.gift || this.gem;
});

const cartSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true,
        unique: true
    },
    items: [cartItemSchema]
}, {
    timestamps: true
});

cartSchema.pre('save', function (next) {
    this.items = this.items.map(item => {
        if (item.gift && !item.gem) {
            item.gem = item.gift;
        }
        if (item.gem && !item.gift) {
            item.gift = item.gem;
        }
        return item;
    });
    next();
});

module.exports = mongoose.model('Cart', cartSchema);



