const mongoose = require('mongoose');

const orderSchema = new mongoose.Schema({
    orderNumber: {
        type: String,
        required: true,
        unique: true
    },
    user: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: true
    },
    items: [
        {
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
                min: [1, 'Quantity must be at least 1']
            },
            price: {
                type: Number,
                required: true,
                min: [0, 'Price cannot be negative']
            },
            seller: {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'User',
                required: true
            }
        }
    ],
    shippingAddress: {
        name: {
            type: String,
            required: true,
            trim: true
        },
        email: {
            type: String,
            trim: true
        },
        phone: {
            type: String,
            required: true,
            trim: true
        },
        addressLine1: {
            type: String,
            required: true,
            trim: true
        },
        addressLine2: {
            type: String,
            trim: true
        },
        city: {
            type: String,
            required: true,
            trim: true
        },
        state: {
            type: String,
            required: true,
            trim: true
        },
        pincode: {
            type: String,
            required: true,
            trim: true
        },
        country: {
            type: String,
            required: true,
            trim: true
        }
    },
    paymentMethod: {
        type: String,
        required: true,
        enum: ['COD', 'Online'],
        default: 'COD'
    },
    paymentStatus: {
        type: String,
        enum: ['pending', 'completed', 'failed'],
        default: 'pending'
    },
    totalPrice: {
        type: Number,
        required: true,
        min: [0, 'Total price cannot be negative']
    },
    status: {
        type: String,
        enum: ['pending', 'processing', 'shipped', 'delivered', 'cancelled'],
        default: 'pending'
    },
    cancelReason: {
        type: String,
        trim: true
    },
    cancelledAt: {
        type: Date
    },
    notes: {
        type: String,
        trim: true
    },
    trackingNumber: {
        type: String,
        trim: true
    },
    courierName: {
        type: String,
        trim: true
    },
    expectedDeliveryDate: {
        type: Date
    }
}, {
    timestamps: true
});

orderSchema.pre('validate', function (next) {
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

// Generate order number and reduce stock before saving
orderSchema.pre('save', async function (next) {
    // Generate order number
    if (!this.orderNumber) {
        const count = await mongoose.model('Order').countDocuments();
        this.orderNumber = `ORD-${new Date().getFullYear()}-${String(count + 1).padStart(3, '0')}`;
    }

    // Reduce stock when order is created
    if (this.isNew) {
        const Gift = mongoose.model('Gift');
        for (const item of this.items) {
            const giftId = item.gift || item.gem;
            await Gift.findByIdAndUpdate(giftId, {
                $inc: {
                    stock: -item.quantity,
                    sales: item.quantity
                }
            });
        }
    }

    next();
});

// Method to restore stock on cancellation
orderSchema.methods.restoreStock = async function () {
    const Gift = mongoose.model('Gift');
    for (const item of this.items) {
        const giftId = item.gift || item.gem;
        await Gift.findByIdAndUpdate(giftId, {
            $inc: {
                stock: item.quantity,
                sales: -item.quantity
            }
        });
    }
};

module.exports = mongoose.model('Order', orderSchema);