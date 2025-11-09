/**
 * Legacy Gem model export.
 * The core schema is now defined in `Gift.js`. This file simply re-exports the
 * shared Gift model so existing `require('../models/Gem')` imports continue to
 * work during the migration period.
 */

module.exports = require('./Gift');