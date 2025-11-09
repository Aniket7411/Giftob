const mongoose = require('mongoose');

const giftSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Gift name is required'],
        trim: true,
        maxlength: [255, 'Name cannot be more than 255 characters']
    },
    category: {
        type: String,
        trim: true,
        maxlength: [150, 'Category cannot be more than 150 characters']
    },
    headline: {
        type: String,
        trim: true,
        maxlength: [280, 'Headline cannot be more than 280 characters']
    },
    description: {
        type: String,
        required: [true, 'Description is required'],
        trim: true
    },
    signatureTouches: {
        type: [String],
        default: []
    },
    personalisation: {
        type: [String],
        default: []
    },
    leadTime: {
        type: String,
        trim: true,
        maxlength: [120, 'Lead time cannot be more than 120 characters']
    },
    price: {
        type: Number,
        required: [true, 'Price is required'],
        min: [0, 'Price cannot be negative']
    },
    discount: {
        type: Number,
        default: 0,
        min: [0, 'Discount cannot be negative']
    },
    discountType: {
        type: String,
        enum: ['percentage', 'flat'],
        default: 'percentage'
    },
    availability: {
        type: Boolean,
        default: true
    },
    stock: {
        type: Number,
        default: 0,
        min: [0, 'Stock cannot be negative']
    },
    sizeWeight: {
        type: String,
        trim: true
    },
    sizeUnit: {
        type: String,
        trim: true,
        default: 'items'
    },
    priceRange: {
        type: String,
        trim: true
    },
    ageRange: {
        type: String,
        trim: true
    },
    recipient: {
        type: String,
        enum: ['boy', 'girl', 'unisex', 'men', 'women', 'kids', 'adults', 'all'],
        default: 'all'
    },
    customizable: {
        type: Boolean,
        default: false
    },
    images: {
        type: [String],
        default: []
    },
    heroImage: {
        type: String,
        trim: true
    },
    additionalImages: {
        type: [String],
        default: []
    },
    averageRating: {
        type: Number,
        default: 0,
        min: [0, 'Average rating cannot be negative'],
        max: [5, 'Average rating cannot be more than 5']
    },
    totalReviews: {
        type: Number,
        default: 0,
        min: [0, 'Total reviews cannot be negative']
    },
    deliveryDays: {
        type: Number,
        min: [0, 'Delivery days cannot be negative']
    },
    seller: {
        type: mongoose.Schema.Types.ObjectId,
        ref: 'User',
        required: [true, 'Seller is required']
    },
    // Legacy fields maintained for backward compatibility during migration
    hindiName: {
        type: String,
        trim: true,
        maxlength: [255, 'Hindi name cannot be more than 255 characters']
    },
    alternateNames: {
        type: [String],
        default: []
    },
    planet: {
        type: String,
        trim: true,
        maxlength: [100, 'Planet name cannot be more than 100 characters']
    },
    planetHindi: {
        type: String,
        trim: true,
        maxlength: [100, 'Planet Hindi name cannot be more than 100 characters']
    },
    color: {
        type: String,
        trim: true,
        maxlength: [100, 'Color cannot be more than 100 characters']
    },
    benefits: {
        type: [String],
        default: []
    },
    suitableFor: {
        type: [String],
        default: []
    },
    whomToUse: {
        type: [String],
        default: []
    },
    certification: {
        type: String,
        trim: true,
        maxlength: [255, 'Certification cannot be more than 255 characters']
    },
    origin: {
        type: String,
        trim: true,
        maxlength: [255, 'Origin cannot be more than 255 characters']
    },
    views: {
        type: Number,
        default: 0
    },
    sales: {
        type: Number,
        default: 0
    },
    rating: {
        type: Number,
        default: 0
    },
    reviews: {
        type: Number,
        default: 0
    },
    lowStockThreshold: {
        type: Number,
        default: 5
    }
}, {
    timestamps: true,
    collection: 'gifts',
    toJSON: { virtuals: true },
    toObject: { virtuals: true }
});

giftSchema.virtual('finalPrice').get(function () {
    if (!this.discount || this.discount === 0) {
        return this.price;
    }

    if (this.discountType === 'flat') {
        return Math.max(0, this.price - this.discount);
    }

    // percentage
    return Math.max(0, this.price - (this.price * (this.discount / 100)));
});

giftSchema.pre('save', function (next) {
    if (typeof this.stock === 'number') {
        if (this.stock <= 0) {
            this.availability = false;
        } else if (!this.availability) {
            this.availability = true;
        }
    }
    next();
});

giftSchema.index({
    name: 'text',
    description: 'text',
    category: 'text',
    headline: 'text',
    signatureTouches: 'text'
}, {
    name: 'gift_text_search',
    weights: {
        name: 10,
        category: 5,
        headline: 5,
        description: 3,
        signatureTouches: 2
    }
});

giftSchema.index({ name: 1 });
giftSchema.index({ category: 1 });
giftSchema.index({ recipient: 1 });
giftSchema.index({ customizable: 1 });
giftSchema.index({ price: 1 });
giftSchema.index({ availability: 1 });
giftSchema.index({ seller: 1 });
giftSchema.index({ createdAt: -1 });

const Gift = mongoose.models.Gift || mongoose.model('Gift', giftSchema);

// Register Gem alias for backwards compatibility
mongoose.models.Gem = Gift;

module.exports = Gift;

