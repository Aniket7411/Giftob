const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
require('dotenv').config();

// Import routes
const authRoutes = require('./routes/auth');
const giftRoutes = require('./routes/gems');
const cartRoutes = require('./routes/cart');
const orderRoutes = require('./routes/orders');
const otpRoutes = require('./routes/otp');
const adminRoutes = require('./routes/admin');
const sellerRoutes = require('./routes/seller');
const userRoutes = require('./routes/user');
const wishlistRoutes = require('./routes/wishlist');
const reviewRoutes = require('./routes/reviews');

const app = express();

// Security middleware
app.use(helmet());

// Rate limiting - Only enabled in production
if (process.env.NODE_ENV === 'production') {
    const authLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 100, // Increased for development
        message: {
            success: false,
            message: 'Too many authentication attempts, please try again later.'
        }
    });

    const otpLimiter = rateLimit({
        windowMs: 60 * 1000, // 1 minute
        max: 10, // Increased for development
        message: {
            success: false,
            message: 'Too many OTP requests, please try again later.'
        }
    });

    const generalLimiter = rateLimit({
        windowMs: 15 * 60 * 1000, // 15 minutes
        max: 1000, // Very high limit for general endpoints
        message: {
            success: false,
            message: 'Too many requests from this IP, please try again later.'
        }
    });

    // Apply rate limiting only in production
    app.use('/api/auth', authLimiter);
    app.use('/api/otp', otpLimiter);
    app.use(generalLimiter);

    console.log('Rate limiting enabled (production mode)');
} else {
    console.log('Rate limiting disabled (development mode)');
}

// CORS configuration
app.use(cors({
    origin: function (origin, callback) {
        // In development, allow all origins
        if (process.env.NODE_ENV !== 'production') {
            return callback(null, true);
        }

        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        const allowedOrigins = [
            'http://localhost:3000',
            'http://localhost:3001',
            'http://localhost:5173', // Vite default port
            'https://auralaneweb.vercel.app',
            'https://gems-frontend-two.vercel.app',
            process.env.CLIENT_URL
        ].filter(Boolean);

        if (allowedOrigins.indexOf(origin) !== -1) {
            callback(null, true);
        } else {
            console.log('CORS blocked origin:', origin);
            callback(null, true); // Allow anyway in case of misconfiguration
        }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
    exposedHeaders: ['Content-Range', 'X-Content-Range'],
    optionsSuccessStatus: 200,
    maxAge: 86400 // Cache preflight requests for 24 hours
}));

// Handle preflight OPTIONS requests
app.options('*', cors());

// Body parser middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Database connection
mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/jewel_backend', {
    useNewUrlParser: true,
    useUnifiedTopology: true,
})
    .then(() => console.log('MongoDB connected successfully'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/gifts', giftRoutes);
app.use('/api/gems', giftRoutes);
app.use('/api/cart', cartRoutes);
app.use('/api/orders', orderRoutes);
app.use('/api/otp', otpRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/seller', sellerRoutes);
app.use('/api/user', userRoutes);
app.use('/api/wishlist', wishlistRoutes);
app.use('/api/reviews', reviewRoutes);

console.log("testing");

// Health check route
app.get('/api/health', (req, res) => {
    res.json({
        success: true,
        message: 'Server is running',
        timestamp: new Date().toISOString()
    });
});

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        message: 'Route not found'
    });
});

// Global error handler
app.use((err, req, res, next) => {
    console.error('Global error handler:', err);

    res.status(err.status || 500).json({
        success: false,
        message: err.message || 'Internal server error',
        ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
    });
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});
