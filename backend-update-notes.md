# Backend Update Notes – Gift Platform Migration

The front-end has been fully realigned around “gifts”. This document describes every API the UI calls, the data formats it sends/expects, and any backwards-compatibility quirks so you can update the backend confidently.

---

## 0. Conventions

| Concern | Value |
| --- | --- |
| Base URL | `http://localhost:5000/api` (dev) – update `.env` as needed |
| Content Type | `application/json` |
| Auth | Bearer token via `Authorization: Bearer <token>`; token stored in localStorage |
| Legacy fallback | UI still understands `gems`, `gemId`, etc. but **prefers** the new gift naming. |

---

## 1. Data Models

### 1.1 Gift
```jsonc
{
  "_id": "string",
  "name": "Birthday Spark Edit",
  "category": "Birthday Gift",
  "headline": "Make midnight moments unforgettable.",
  "description": "Long form copy…",
  "signatureTouches": ["Ambient LED sparkler candles", "..."],
  "personalisation": ["Name foil-printing", "..."],
  "leadTime": "24 hours (express) · 72 hours (custom)",
  "price": 4200,
  "discount": 10,
  "discountType": "percentage",          // or "flat"
  "availability": true,
  "stock": 12,
  "sizeWeight": "6",
  "sizeUnit": "items",
  "priceRange": "₹2,800 – ₹6,500",
  "ageRange": "10-12",                    // optional
  "recipient": "boy",                     // "boy" | "girl" | "unisex"
  "customizable": true,
  "images": ["https://..."],
  "heroImage": "https://...",
  "additionalImages": ["https://..."],
  "averageRating": 4.8,
  "totalReviews": 23,
  "deliveryDays": 3,
  "seller": {
    "_id": "sellerId",
    "shopName": "Aurelane Studio",
    "fullName": "Curator Name",
    "rating": 4.9,
    "isVerified": true
  }
}
```

### 1.2 Seller Profile (stored under `/seller/profile`)
```jsonc
{
  "fullName": "Curator Name",
  "email": "curator@example.com",
  "phone": "+91...",
  "shopName": "Aurelane Studio",
  "shopType": "Online Store",
  "businessType": "Private Limited",
  "yearEstablished": "2021",
  "giftTypes": ["Birthday surprises", "Wedding festivities"],
  "gemTypes": ["Birthday surprises", "Wedding festivities"],   // maintained for backwards compat
  "specialization": ["Signature Gift Playbooks"],
  "address": {
    "street": "123 Aure Lane",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001",
    "country": "India"
  },
  "bankName": "HDFC Bank",
  "accountNumber": "XXXX",
  "ifscCode": "HDFC0001234",
  "accountHolderName": "Curator Name",
  "gstNumber": "XX...",
  "panNumber": "ABCDE1234F",
  "aadharNumber": "XXXX XXXX XXXX",
  "documentsUploaded": true,
  "isVerified": true,
  "stats": {
    "totalGifts": 24,
    "totalGems": 24                 // optional legacy field
  }
}
```

### 1.3 Order (request payload)
```jsonc
{
  "items": [
    {
      "giftId": "giftObjectId",
      "gemId": "giftObjectId",       // sent for compatibility – backend may ignore
      "quantity": 2,
      "price": 3900                  // final unit price after discount
    }
  ],
  "shippingAddress": {
    "firstName": "Aure",
    "lastName": "Lane",
    "email": "buyer@example.com",
    "phone": "9999999999",
    "address": "Flat / Street",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001"
  },
  "paymentMethod": "cod",            // "cod" | "online"
  "orderNotes": "Leave at reception",
  "totalAmount": 7800
}
```

### 1.4 Wishlist Item (expected response)
```jsonc
{
  "_id": "wishlistId",
  "gift": { ...giftObject },
  "addedAt": "2025-11-09T10:15:30.000Z"
}
```

### 1.5 Cart Item (expected response)
```jsonc
{
  "giftId": "giftObjectId",
  "quantity": 2,
  "price": 3900,
  "gift": { ...giftObject }
}
```

---

## 2. Public / Buyer APIs

### 2.1 Authentication & Account
| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/auth/signup` | Body: `{ name, email, password, phone, role }`. Returns `{ success, token, user }`. |
| `POST` | `/auth/login` | Body: `{ email, password }`. Same response structure. |
| `POST` | `/auth/forgot-password` | `{ email }`. |
| `PUT` | `/auth/reset-password/:token` | `{ password }`. |
| `GET` | `/auth/reset-password/:token` | validity check. |
| `GET` | `/auth/verify-email/:token` | verify email. |
| `GET` | `/user/profile` | Buyer profile (requires auth). |
| `PUT` | `/user/profile` | Body mirrors profile fields (name, phone, DOB, etc.). |

### 2.2 Address Book
| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/user/addresses` | Returns `{ success, addresses: [] }`. |
| `POST` | `/user/addresses` | Body: `{ name, phone, addressLine1, addressLine2, city, state, pincode, isPrimary }`. |
| `PUT` | `/user/addresses/:id` | Update address. |
| `PUT` | `/user/addresses/:id/primary` | Mark as primary. |
| `DELETE` | `/user/addresses/:id` | Remove address. |

### 2.3 OTP (guest checkout flow)
| Method | Route | Body |
| --- | --- | --- |
| `POST` | `/otp/send` | `{ phoneNumber }` |
| `POST` | `/otp/verify` | `{ phoneNumber, otp }` |

### 2.4 Gift Catalogue
| Method | Route | Description |
| --- | --- | --- |
| `GET` | `/gifts` | Supports query params: `search`, `category`, `minPrice`, `maxPrice`, `sort` (`newest`, `price-low`, `price-high`, `oldest`), `ageRange`, `recipient`, `customizable`, `page`, `limit`. Response: `{ success, data: { gifts: [], pagination: { currentPage, totalPages, totalItems, hasNext, hasPrev, itemsPerPage } } }`. The UI also checks `response.gifts` and `response.data.items`. |
| `GET` | `/gifts/:id` | Returns `{ success, data: gift }`. Related products can be returned under `relatedProducts`. |
| `POST` | `/gifts/search` | (optional) Body contains advanced search filters. If unused, may stub. |
| `GET` | `/gifts/categories` | Returns `{ success, data: ["Birthday Gift", ...] }`. |
| `GET` | `/gifts/suggestions` | Query: `search`. Returns `{ success, data: { gifts: ["Birthday Spark Edit", ...] } }`. |
| `GET` | `/gifts/category/:category` | Category-specific list (optional). |
| `GET` | `/gifts/audience/:audience` | Audience-specific list (legacy zodiac filter – map to kids/adult). |

> **Compatibility note:** while the UI will read `response.data.gems`/`response.gems`, please update the backend to emit `gifts`. Keep aliases during migration.

### 2.5 Wishlist
| Method | Route | Body | Notes |
| --- | --- | --- | --- |
| `POST` | `/wishlist/add` | `{ giftId }` | Accept `gemId` for legacy clients if needed. |
| `GET` | `/wishlist` | — | Return `{ success, items: [wishlistItem] }`. |
| `DELETE` | `/wishlist/remove/:giftId` | — | Remove specific item. |
| `DELETE` | `/wishlist/clear` | — | Remove all items. |
| `GET` | `/wishlist/check/:giftId` | — | Response `{ success, isInWishlist: true/false }`. |

### 2.6 Cart
| Method | Route | Body / Notes |
| --- | --- | --- |
| `POST` | `/cart/add` | `{ giftId, quantity }` |
| `GET` | `/cart` | Expect `{ success, items: [cartItem], summary: { subtotal, shipping, total, freeShippingThreshold, isEligibleForFreeShipping, itemCount } }`. |
| `PUT` | `/cart/update/:giftId` | `{ quantity }` |
| `DELETE` | `/cart/remove/:giftId` | — |
| `DELETE` | `/cart/clear` | — |

### 2.7 Orders (Buyer)
| Method | Route | Details |
| --- | --- | --- |
| `POST` | `/orders` | Body per **1.3 Order**. Should respond `{ success, orderId }` (or `{ data: { orderId } }`). |
| `GET` | `/orders` | List current user's orders. |
| `GET` | `/orders/:id` | Order details (with items, totals, status, payment info). |
| `PUT` | `/orders/:id/cancel` | `{ reason }`. |
| `GET` | `/orders/:id/track` | Tracking checkpoints. |
| `GET` | `/orders/:id/invoice` | Binary (PDF). |

### 2.8 Reviews
| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/reviews/:giftId` | `{ rating, comment }`. |
| `GET` | `/reviews/gift/:giftId` | Supports pagination query params. |
| `GET` | `/reviews/user` | Reviews by logged-in user. |
| `PUT` | `/reviews/:reviewId` | Update review. |
| `DELETE` | `/reviews/:reviewId` | Delete review. |
| `GET` | `/reviews/check/:giftId` | Returns `{ success, hasReviewed: boolean }`. |

---

## 3. Seller APIs

### 3.1 Profile & Dashboard
| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/seller/profile` | Return seller profile as in **1.2**. Include `giftTypes`, `stats.totalGifts`. |
| `PUT` | `/seller/profile` | Accept same shape; UI sends both `giftTypes` and `gemTypes`. Prefer persisting `giftTypes`. |
| `GET` | `/seller/dashboard/stats` | Suggested fields: `totalGifts`, `totalOrders`, `pendingOrders`, `revenue`, `averageRating`. |

### 3.2 Gift Management
| Method | Route | Notes |
| --- | --- | --- |
| `POST` | `/gifts` | Body: gift object (excluding calculated fields). |
| `PUT` | `/gifts/:id` | Update gift. |
| `DELETE` | `/gifts/:id` | Remove gift. |

### 3.3 Seller Orders
| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/seller/orders` | Supports filters: `status`, `fromDate`, `toDate`, `page`, `limit`. |
| `GET` | `/seller/orders/:id` | Order detail for seller (should include buyer info + items). |
| `PUT` | `/seller/orders/:id/status` | Body `{ status, trackingNumber?, courierName?, expectedDeliveryDate? }`. Status values: `processing`, `packed`, `shipped`, `delivered`, `cancelled`. |
| `GET` | `/seller/orders/stats` | Summary (today’s orders, pending, etc.). |

---

## 4. Admin APIs

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/admin/dashboard/stats` | Overall metrics (totalGifts, totalOrders, totalRevenue, totalUsers, monthlySales[]). |
| `GET` | `/admin/sellers` | Query filters: `search`, `status`, `page`, `limit`. |
| `GET` | `/admin/sellers/:id` | Full seller profile + listed gifts (array). |
| `PUT` | `/admin/sellers/:id/status` | `{ status: 'approved' | 'rejected' }`. |
| `PUT` | `/admin/sellers/:id/block` | Block seller. |
| `PUT` | `/admin/sellers/:id/unblock` | Unblock. |
| `DELETE` | `/admin/sellers/:id` | Delete seller. |
| `GET` | `/admin/buyers` | Buyer list (filters: `search`, `status`, `page`). |
| `GET` | `/admin/buyers/:id` | Buyer profile/orders. |
| `PUT` | `/admin/buyers/:id/block` | Block buyer. |
| `PUT` | `/admin/buyers/:id/unblock` | Unblock buyer. |
| `GET` | `/admin/products` | Gift catalogue for moderation (filters: `search`, `category`, `sellerId`, `status`, `page`). |
| `GET` | `/admin/products/:id` | Gift detail with seller info. |
| `DELETE` | `/admin/products/:id` | Remove gift. |
| `GET` | `/admin/orders` | List all orders (filters: `status`, `paymentMethod`, `dateRange`). |
| `GET` | `/admin/orders/:id` | Order detail. |

> Replace all “product” responses to use the gift schema. Continue to expose `totalGems` while migrating, but populate `totalGifts` for new dashboards.

---

## 5. Miscellaneous

| Method | Route | Notes |
| --- | --- | --- |
| `GET` | `/health` | Simple health probe (return `{ status: 'ok' }`). |

### Placeholders & Assets
- Replace `/placeholder-gem.jpg` with a gift-friendly asset when available. Until then, keep the file name for compatibility.

### Razorpay Integration
- Online checkout expects the backend to return Razorpay order details or to proxy the key. Current front-end stub loads Razorpay script and expects the backend to generate the Razorpay order id via `handleOnlinePayment(orderId, amount)`. Update the relevant controller accordingly.

---

## 6. Compatibility Checklist

1. **Routes**: Keep old `/gems` endpoints aliased to `/gifts` until mobile / legacy clients migrate.
2. **Payload keys**: emit `gifts`, `giftId`, `giftTypes`; still accept/read `gems`, `gemId`, `gemTypes` while refactoring.
3. **Counters & stats**: compute `totalGifts` everywhere (`totalGems` optional fallback).
4. **Seed data**: populate playbook-style gifts to match the UI cards (birthday, first meeting, love, etc.). Ensure new fields (`signatureTouches`, `personalisation`, `leadTime`) are filled so the detail view renders properly.
5. **Error messages**: front-end surfaces the `message` field from error responses. Provide meaningful text when rejecting requests (validation / auth / stock).

Once the backend aligns with the contract above, the gift storefront, seller hub, and admin panels will run end-to-end with the new experience. Feel free to extend this document with any backend-specific notes as you continue the migration.
